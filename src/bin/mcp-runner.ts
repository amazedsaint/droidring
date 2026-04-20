import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startHttpMcp } from '../mcp/http.js';
import { buildServer } from '../mcp/server.js';
import { loadConfig, loadOrCreateIdentity } from '../p2p/identity.js';
import { RoomManager } from '../p2p/manager.js';
import { openDatabase } from '../store/db.js';
import { Repo } from '../store/repo.js';

const VERSION = '0.1.0';

function detectClient(): string {
  // The env var is set by MCP clients in some cases; otherwise we guess from argv.
  return process.env.MCP_CLIENT_NAME || 'unknown';
}

export async function buildContextAndServer(): Promise<{
  server: any;
  manager: RoomManager;
  repo: Repo;
}> {
  const identity = loadOrCreateIdentity();
  const config = loadConfig();
  const db = openDatabase();
  const repo = new Repo(db);
  const manager = new RoomManager({
    identity,
    repo,
    nickname: config.nickname,
    clientName: detectClient(),
    version: VERSION,
  });
  await manager.start();
  const server = buildServer({ ctx: { manager, repo }, version: VERSION });
  return { server, manager, repo };
}

export async function runStdioServer(opts: { web?: boolean } = {}): Promise<void> {
  const { server, manager, repo } = await buildContextAndServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (opts.web) await launchWebSidecar(manager, repo);
}

async function launchWebSidecar(manager: RoomManager, repo: Repo): Promise<void> {
  const { startWebServer } = await import('../web/server.js');
  const { loadOrCreateToken } = await import('../web/auth.js');
  const { tryOpenBrowser } = await import('../web/open-browser.js');

  const token = loadOrCreateToken();
  const preferredPort = Number(process.env.AGENTCHAT_WEB_PORT || 7879);

  let srv: Awaited<ReturnType<typeof startWebServer>>;
  try {
    srv = await startWebServer({ host: '127.0.0.1', port: preferredPort, manager, repo, token });
  } catch (e: any) {
    if (e?.code === 'EADDRINUSE') {
      // Likely another agentchat-mcp session already has the UI up — don't
      // double-open the browser, just log and skip.
      process.stderr.write(
        `[agentchat] web UI port ${preferredPort} busy; another instance is probably serving it.\n`,
      );
      return;
    }
    process.stderr.write(`[agentchat] web UI failed to start: ${e?.message || e}\n`);
    return;
  }

  const url = `${srv.url}/#token=${token}`;
  process.stderr.write(`[agentchat] web UI: ${url}\n`);

  if (process.env.AGENTCHAT_WEB_OPEN !== '0') tryOpenBrowser(url);
}

export async function runHttpServer(host: string, port: number): Promise<void> {
  const { manager, repo } = await buildContextAndServer();
  startHttpMcp({
    host,
    port,
    build: async () => buildServer({ ctx: { manager, repo }, version: VERSION }),
  });
  console.error(`[agentchat] Streamable HTTP MCP listening on http://${host}:${port}/mcp`);
}
