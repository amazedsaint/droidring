import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { base32Encode } from '../p2p/base32.js';
import {
  droidringDir,
  identityPath,
  loadConfig,
  loadOrCreateIdentity,
  saveConfig,
} from '../p2p/identity.js';
import {
  cronSupported,
  ensureDaemon,
  installCron,
  serviceLogPath,
  serviceStatus,
  uninstallCron,
} from '../service/service.js';
import { openDatabase } from '../store/db.js';
import { Repo } from '../store/repo.js';
import { LAUNCH_KINDS, type LaunchKind, launchShell } from '../web/launch-shell.js';
import { readWebUrl } from '../web/url-file.js';
import { buildContextAndServer, runHttpServer, runStdioServer } from './mcp-runner.js';

// Gracefully exit when a downstream consumer closes the pipe
// (e.g. `droidring service status | head -3`). Without this, Node throws
// EPIPE as an unhandled 'error' event and the CLI dies with a stack trace.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const program = new Command();

program.name('droidring').description('Peer-to-peer encrypted chat for AI agents').version('1.1.0');

program
  .command('mcp')
  .description('Run the MCP server')
  .option('--http <addr>', 'Run Streamable HTTP MCP (e.g. :7777 or 127.0.0.1:7777)')
  .option('--web', 'Also boot the web UI on a local port and auto-open the browser')
  .action(async (opts) => {
    if (opts.http) {
      const [hostPart, portPart] = String(opts.http).includes(':')
        ? String(opts.http).split(':')
        : ['127.0.0.1', String(opts.http)];
      const host = hostPart || '127.0.0.1';
      const port = Number(portPart || 7777);
      await runHttpServer(host, port);
    } else {
      await runStdioServer({ web: Boolean(opts.web) });
    }
  });

program
  .command('daemon')
  .description('Run the long-lived daemon (swarm + HTTP MCP)')
  .option('--port <port>', 'HTTP port', '7777')
  .option('--host <host>', 'HTTP host', '127.0.0.1')
  .action(async (opts) => {
    await runHttpServer(opts.host, Number(opts.port));
  });

program
  .command('web')
  .description('Run the Discord-like web UI + REST + WebSocket server')
  .option('--port <port>', 'port (default: $DROIDRING_WEB_PORT or 7879)')
  .option('--host <host>', 'bind host (default: $DROIDRING_WEB_HOST or 127.0.0.1)')
  .action(async (opts) => {
    const port = Number(opts.port || process.env.DROIDRING_WEB_PORT || 7879);
    const host = opts.host || process.env.DROIDRING_WEB_HOST || '127.0.0.1';
    const { buildContextAndServer, registerSession, maybeJoinRepoRoom } = await import(
      './mcp-runner.js'
    );
    const { manager, repo } = await buildContextAndServer();
    const { startWebServer } = await import('../web/server.js');
    const { loadOrCreateToken } = await import('../web/auth.js');
    const { writeWebUrl, clearWebUrl } = await import('../web/url-file.js');
    const token = loadOrCreateToken();
    const session = registerSession(repo, { client: 'web' });
    await maybeJoinRepoRoom(manager, session);
    const srv = await startWebServer({
      host,
      port,
      manager,
      repo,
      token,
    });
    const linkable = `${srv.url}/#token=${token}`;
    writeWebUrl(linkable);
    process.stderr.write('\n  ┌─ droidring web UI ──────────────────────────────────────\n');
    process.stderr.write(`  │  open this:  ${linkable}\n`);
    process.stderr.write(`  │  bind:       ${srv.url}\n`);
    process.stderr.write('  │  also saved to ~/.droidring/web-url  (droidring url to print)\n');
    process.stderr.write('  └─────────────────────────────────────────────────────────\n\n');
    const stop = async () => {
      session.cleanup();
      clearWebUrl();
      await srv.close();
      await manager.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });

program
  .command('url')
  .description('Print the current web UI URL (with auto-login token)')
  .action(async () => {
    const { readWebUrl, webUrlPath } = await import('../web/url-file.js');
    const url = readWebUrl();
    if (!url) {
      process.stderr.write(
        `No web URL recorded at ${webUrlPath()}.\nStart one with \`droidring web\` or let \`droidring-mcp\` boot it.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${url}\n`);
  });

program
  .command('tui')
  .description('Attach the Ink TUI to a running daemon (or start one in-process)')
  .option('--daemon <url>', 'Daemon URL (e.g. http://127.0.0.1:7777/mcp)')
  .action(async (opts) => {
    const { startTui } = await import('../tui/app.js');
    await startTui({ daemonUrl: opts.daemon });
  });

/**
 * Figure out the absolute path to the installed `droidring` binary so we can
 * bake it into a cron entry. The value must survive shell-environment
 * differences (cron has a minimal PATH), so we resolve the symlink to a
 * canonical path before writing it.
 */
function resolveDroidringBin(): string {
  if (process.env.DROIDRING_BIN && existsSync(process.env.DROIDRING_BIN)) {
    return realpathSync(process.env.DROIDRING_BIN);
  }
  const which = spawnSync('which', ['droidring'], { encoding: 'utf8' });
  if (which.status === 0) {
    const path = which.stdout.trim();
    if (path && existsSync(path)) return realpathSync(path);
  }
  // Fall back to argv[1] — the very process the user just invoked.
  const entry = process.argv[1];
  if (entry && existsSync(entry)) return realpathSync(entry);
  return entry || 'droidring';
}

function formatHeartbeat(ts: number): string {
  const age = Math.max(0, Date.now() - ts);
  if (age < 60_000) return `${Math.round(age / 1000)}s ago`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`;
  return `${Math.round(age / 3_600_000)}h ago`;
}

program
  .command('ensure')
  .description(
    'Internal: ensure the background droidring web daemon is alive. Invoked by the cron entry installed by `droidring service install`.',
  )
  .action(async () => {
    await ensureDaemon(resolveDroidringBin());
  });

const serviceCmd = program
  .command('service')
  .description(
    'Manage the persistent background service (keeps droidring running across sessions)',
  );

serviceCmd
  .command('install')
  .description('Install a cron entry so droidring web stays alive across terminal sessions')
  .action(() => {
    const bin = resolveDroidringBin();
    if (!cronSupported()) {
      process.stderr.write(
        `crontab is not available on this platform. Run \`droidring web\` in a
long-lived terminal, or use your OS service manager (launchd, systemd,
Task Scheduler) to run:

    ${bin} web
`,
      );
      process.exit(1);
    }
    const r = installCron(bin);
    if (!r.ok) {
      process.stderr.write(`[droidring] service install failed: ${r.error}\n`);
      process.exit(1);
    }
    process.stdout.write(
      `[droidring] persistent service installed.
  cron entry:   * * * * * ${bin} ensure
  service log:  ${serviceLogPath()}
  Run \`droidring service status\` to check, \`droidring service uninstall\` to remove.
`,
    );
    // Kick off the first keeper immediately so the user doesn't wait up to
    // a minute for cron to fire.
    ensureDaemon(bin).catch(() => {});
  });

serviceCmd
  .command('uninstall')
  .description('Remove the cron entry. The running droidring web is left alone.')
  .action(() => {
    const r = uninstallCron();
    if (!r.ok) {
      process.stderr.write(`[droidring] service uninstall failed: ${r.error}\n`);
      process.exit(1);
    }
    process.stdout.write(
      '[droidring] persistent service removed.\n' +
        '  The currently-running droidring web (if any) is still up.\n' +
        '  Stop it manually with: droidring service status  (shows the pid)\n',
    );
  });

serviceCmd
  .command('status')
  .description('Show the persistent service status and web URL')
  .action(() => {
    const s = serviceStatus();
    process.stdout.write(`service running : ${s.running ? 'yes' : 'no'}\n`);
    if (s.pid) process.stdout.write(`pid             : ${s.pid}\n`);
    if (s.web_url) process.stdout.write(`web url         : ${s.web_url}\n`);
    if (s.last_heartbeat) {
      process.stdout.write(
        `last heartbeat  : ${new Date(s.last_heartbeat).toISOString()} (${formatHeartbeat(
          s.last_heartbeat,
        )})\n`,
      );
    }
    if (s.stale) process.stdout.write('                  (heartbeat is stale)\n');
    if (!s.cron_supported) {
      process.stdout.write('cron            : unsupported on this platform\n');
    } else {
      process.stdout.write(`cron installed  : ${s.cron_installed ? 'yes' : 'no'}\n`);
    }
    process.stdout.write(`service log     : ${serviceLogPath()}\n`);
  });

program
  .command('launch')
  .description(
    'Start droidring web and open the best available interface (Electron, browser, or TUI)',
  )
  .option('--kind <kind>', 'Force a specific interface: electron | browser | tui | none', 'auto')
  .option('--no-start', 'Assume a droidring server is already running — just open the UI')
  .action(async (opts) => {
    const requested = String(opts.kind || 'auto').toLowerCase();
    const valid = [...LAUNCH_KINDS, 'tui'];
    if (!valid.includes(requested)) {
      process.stderr.write(`[droidring] unknown --kind '${requested}'\n`);
      process.exit(2);
    }

    // TUI boots its own in-process manager — no web server required.
    if (requested === 'tui') {
      const { startTui } = await import('../tui/app.js');
      await startTui({});
      return;
    }

    // ensureDaemon() returns the URL it discovered, so we don't need to
    // poll a second time after it returns.
    let url = readWebUrl();
    if (!url && opts.start !== false) {
      url = await ensureDaemon(resolveDroidringBin());
    }
    if (!url) {
      process.stderr.write(
        '[droidring] no running web server. Start one with `droidring web` or\n' +
          '            install the persistent service (`droidring service install`).\n',
      );
      process.exit(1);
    }

    const used = await launchShell(url, { kind: requested as LaunchKind });
    if (used === 'none' && requested === 'electron') {
      process.stderr.write(
        '[droidring] electron is not installed. Re-run install.sh with\n' +
          '            DROIDRING_ELECTRON=1, or fall back to `--kind browser`.\n',
      );
      process.exit(1);
    }
    if (used === 'none') {
      process.stdout.write(`${url}\n`);
      process.stdout.write(
        '[droidring] no GUI available (headless / SSH). Open the URL above in your\n' +
          '            browser, or run `droidring tui` for the console interface.\n',
      );
    } else {
      process.stdout.write(`[droidring] opened via ${used}: ${url}\n`);
    }
  });

program
  .command('wallet')
  .description(
    'Manage your Ed25519 identity (aka wallet). Use this to move your droidring identity between machines so your agents all show up as the same user.',
  )
  .addCommand(
    new Command('show').description('Print your public key + the on-disk path').action(() => {
      const id = loadOrCreateIdentity();
      const hex = Buffer.from(id.publicKey).toString('hex');
      const b32 = base32Encode(id.publicKey);
      process.stdout.write(`pubkey (hex):    ${hex}\n`);
      process.stdout.write(`pubkey (base32): ${b32}\n`);
      process.stdout.write(`identity file:   ${identityPath()}\n`);
      process.stdout.write(
        '\nThe private key in that file is secret. Treat it like an SSH private key:\n' +
          '  - 0600 permissions (already enforced)\n' +
          '  - never commit to git\n' +
          '  - to use the same identity on another machine, run\n' +
          '      droidring wallet export --out /tmp/droidring-wallet.json\n' +
          '    copy the file to the other machine (scp / secure channel), then\n' +
          '      droidring wallet import /tmp/droidring-wallet.json\n',
      );
    }),
  )
  .addCommand(
    new Command('export')
      .description('Export your identity.json to a file or stdout')
      .option('--out <path>', 'where to write (default: stdout)')
      .action((opts) => {
        const src = identityPath();
        if (!existsSync(src)) {
          console.error('No identity yet — run `droidring` once to create one.');
          process.exit(2);
        }
        const raw = readFileSync(src, 'utf8');
        if (opts.out) {
          writeFileSync(opts.out, raw);
          try {
            chmodSync(opts.out, 0o600);
          } catch {
            /* best-effort */
          }
          process.stderr.write(
            `[droidring] exported to ${opts.out} (mode 0600). TREAT THIS FILE AS SECRET.\n`,
          );
        } else {
          process.stdout.write(raw);
        }
      }),
  )
  .addCommand(
    new Command('import')
      .description('Import an identity.json from another machine (overwrites the local one)')
      .argument('<file>', 'path to the exported identity.json')
      .option('-y, --yes', 'skip confirmation')
      .action((file: string, opts) => {
        if (!existsSync(file)) {
          console.error(`File not found: ${file}`);
          process.exit(2);
        }
        const incoming = readFileSync(file, 'utf8');
        let parsed: any;
        try {
          parsed = JSON.parse(incoming);
        } catch {
          console.error('Not valid JSON.');
          process.exit(2);
        }
        if (
          typeof parsed !== 'object' ||
          parsed.version !== 1 ||
          typeof parsed.publicKey !== 'string' ||
          typeof parsed.privateKey !== 'string'
        ) {
          console.error(
            'Not a droidring identity file (expected version=1 + publicKey + privateKey).',
          );
          process.exit(2);
        }
        const dest = identityPath();
        if (existsSync(dest) && !opts.yes) {
          // Backup first so an accidental import is recoverable.
          const backup = `${dest}.backup-${Date.now()}`;
          writeFileSync(backup, readFileSync(dest, 'utf8'));
          try {
            chmodSync(backup, 0o600);
          } catch {
            /* ignore */
          }
          process.stderr.write(`[droidring] backed up existing identity to ${backup}\n`);
        }
        mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
        writeFileSync(dest, incoming);
        try {
          chmodSync(dest, 0o600);
        } catch {
          /* ignore */
        }
        process.stderr.write(
          '[droidring] identity replaced. You are now the user whose key you imported.\n',
        );
      }),
  );

program
  .command('ticket')
  .description('Ticket utilities')
  .addCommand(
    new Command('create').argument('<name>', 'room name').action(async (name: string) => {
      const { manager } = await buildContextAndServer();
      const room = await manager.createRoom(name);
      process.stdout.write(`${room.toTicket()}\n`);
      await manager.stop();
      process.exit(0);
    }),
  )
  .addCommand(
    new Command('show').argument('<room>', 'room name or id').action(async (name: string) => {
      const db = openDatabase();
      const repo = new Repo(db);
      const row = repo.resolveRoom(name);
      if (!row) {
        console.error('No such room');
        process.exit(2);
      }
      // We cannot regenerate the live peer list here, so ticket.show prints a minimal ticket.
      const { encodeTicket } = await import('../p2p/ticket.js');
      const { base32Decode } = await import('../p2p/base32.js');
      const id = loadOrCreateIdentity();
      process.stdout.write(
        `${encodeTicket({
          roomName: row.name,
          rootSecret: base32Decode(row.root_secret),
          bootstrapPubkeys: [id.publicKey],
        })}\n`,
      );
    }),
  );

program
  .command('doctor')
  .description('Check install health')
  .action(async () => {
    const dir = droidringDir();
    const checks: Array<[string, boolean, string]> = [];
    checks.push(['~/.droidring exists', existsSync(dir), dir]);
    const id = loadOrCreateIdentity();
    checks.push([
      'identity loaded',
      true,
      `pub=${Buffer.from(id.publicKey).toString('hex').slice(0, 12)}…`,
    ]);
    try {
      openDatabase().close();
      checks.push(['sqlite writable', true, join(dir, 'store.db')]);
    } catch (e: any) {
      checks.push(['sqlite writable', false, e.message]);
    }
    try {
      const { Swarm } = await import('../p2p/swarm.js');
      const s = new Swarm();
      await s.start();
      await s.destroy();
      checks.push(['hyperswarm reachable', true, 'ok']);
    } catch (e: any) {
      checks.push(['hyperswarm reachable', false, e.message]);
    }
    let all = true;
    for (const [name, ok, detail] of checks) {
      if (!ok) all = false;
      process.stdout.write(`${ok ? '[OK] ' : '[FAIL]'} ${name.padEnd(24)} ${detail}\n`);
    }
    const cfg = loadConfig();
    process.stdout.write(`nickname: ${cfg.nickname}\n`);
    const { readWebUrl } = await import('../web/url-file.js');
    const url = readWebUrl();
    if (url) process.stdout.write(`web URL:  ${url}\n`);
    process.exit(all ? 0 : 1);
  });

program
  .command('nick')
  .argument('<nickname>')
  .description('Set your nickname')
  .action((nick: string) => {
    const cfg = loadConfig();
    cfg.nickname = nick;
    saveConfig(cfg);
    process.stdout.write(`nickname set to ${nick}\n`);
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
