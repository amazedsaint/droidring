/**
 * Persistent-service glue.
 *
 * Lets a user install a POSIX cron entry that keeps a background
 * `droidring web` alive across terminal sessions, so multiple Claude Code
 * agents and the web UI all see a single shared daemon. The cron fires
 * `droidring ensure` every minute, which:
 *   1. reads the heartbeat file — if the pid is alive and the last
 *      heartbeat is fresh (< 5 min), just re-stamp it and exit.
 *   2. otherwise, detaches a new `droidring web` process, waits briefly
 *      for it to write ~/.droidring/web-url, and records its pid.
 *
 * The heartbeat file (`~/.droidring/service.heartbeat`, 0600) is
 * authoritative — any other droidring process (MCP, TUI) can read it to
 * discover the shared daemon. Cron is POSIX-only; on Windows, install()
 * returns { ok: false, error: ... } and the caller prints a manual-start
 * suggestion instead.
 */
import { type SpawnSyncReturns, spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { droidringDir, writeSecretFile } from '../p2p/identity.js';
import { readWebUrl } from '../web/url-file.js';

const CRON_MARK = '# droidring persistent service (added by `droidring service install`)';
const CRON_SCHEDULE = '* * * * *';
/** The daemon is considered stale if it hasn't stamped this often. */
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

export interface ServiceHeartbeat {
  pid: number;
  web_url?: string;
  started_at: number;
  last_heartbeat: number;
}

export interface ServiceStatus {
  running: boolean;
  stale: boolean;
  pid?: number;
  web_url?: string;
  started_at?: number;
  last_heartbeat?: number;
  cron_installed: boolean;
  cron_supported: boolean;
}

export function heartbeatPath(): string {
  return join(droidringDir(), 'service.heartbeat');
}

export function serviceLogPath(): string {
  return join(droidringDir(), 'service.log');
}

export function writeHeartbeat(data: { pid: number; web_url?: string; started_at?: number }): void {
  const now = Date.now();
  const existing = readHeartbeat();
  const started_at = data.started_at ?? existing?.started_at ?? now;
  const hb: ServiceHeartbeat = {
    pid: data.pid,
    web_url: data.web_url,
    started_at,
    last_heartbeat: now,
  };
  writeSecretFile(heartbeatPath(), `${JSON.stringify(hb, null, 2)}\n`);
}

export function readHeartbeat(): ServiceHeartbeat | null {
  try {
    const raw = readFileSync(heartbeatPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid !== 'number' || typeof parsed?.last_heartbeat !== 'number') return null;
    return parsed as ServiceHeartbeat;
  } catch {
    return null;
  }
}

export function clearHeartbeat(): void {
  try {
    unlinkSync(heartbeatPath());
  } catch {
    /* ignore */
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    // kill(pid, 0) checks existence without actually signalling.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------- cron handling ----------

let _cronSupported: boolean | undefined;
export function cronSupported(): boolean {
  if (_cronSupported !== undefined) return _cronSupported;
  if (process.platform === 'win32') {
    _cronSupported = false;
  } else {
    const r = spawnSync('which', ['crontab'], { encoding: 'utf8' });
    _cronSupported = r.status === 0 && r.stdout.trim().length > 0;
  }
  return _cronSupported;
}

function runCrontab(args: string[], input?: string): SpawnSyncReturns<string> {
  return spawnSync('crontab', args, { encoding: 'utf8', input });
}

/** Returns the current crontab as an array of lines, or [] if none. */
export function readCrontab(): string[] {
  // `crontab -l` exits non-zero both when there's no crontab and on a real
  // error; either way an empty stdout is the right baseline — install() will
  // surface write failures later.
  return (runCrontab(['-l']).stdout || '').split('\n');
}

/** Replace the user's crontab with the given lines. Joins with \n. */
export function writeCrontab(lines: string[]): boolean {
  const payload = `${lines.filter((l, i) => !(l === '' && i === lines.length - 1)).join('\n')}\n`;
  const r = runCrontab(['-'], payload);
  return r.status === 0;
}

export function cronInstalled(): boolean {
  if (!cronSupported()) return false;
  return readCrontab().some((l) => l.includes(CRON_MARK));
}

export function installCron(droidringBin: string): { ok: boolean; error?: string } {
  if (!cronSupported()) {
    return { ok: false, error: 'crontab not available on this platform' };
  }
  const lines = readCrontab();
  if (lines.some((l) => l.includes(CRON_MARK))) return { ok: true };
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push(...droidringCronLines(droidringBin));
  const ok = writeCrontab(lines);
  return ok ? { ok: true } : { ok: false, error: 'crontab write failed' };
}

/**
 * Pure helper: strip the marker line and the scheduled-command line that
 * follows it. Safe to unit-test without touching the host crontab.
 */
export function filterOutDroidringCronLines(lines: string[]): string[] {
  const filtered: string[] = [];
  let skipNext = false;
  for (const line of lines) {
    if (skipNext) {
      skipNext = false;
      continue; // drop the command line that followed our marker
    }
    if (line.includes(CRON_MARK)) {
      skipNext = true;
      continue;
    }
    filtered.push(line);
  }
  return filtered;
}

/**
 * Pure helper: build the droidring-service lines to append to a crontab.
 */
export function droidringCronLines(droidringBin: string): string[] {
  return [CRON_MARK, `${CRON_SCHEDULE} ${droidringBin} ensure >> ${serviceLogPath()} 2>&1`];
}

export function uninstallCron(): { ok: boolean; error?: string } {
  if (!cronSupported()) return { ok: true }; // nothing to do
  const lines = readCrontab();
  const filtered = filterOutDroidringCronLines(lines);
  const ok = writeCrontab(filtered);
  return ok ? { ok: true } : { ok: false, error: 'crontab write failed' };
}

// ---------- status + ensure ----------

export function serviceStatus(): ServiceStatus {
  const cron_supported = cronSupported();
  const cron_installed = cron_supported && cronInstalled();
  const hb = readHeartbeat();
  if (!hb) return { running: false, stale: false, cron_installed, cron_supported };
  const alive = isProcessAlive(hb.pid);
  const stale = Date.now() - hb.last_heartbeat > HEARTBEAT_STALE_MS;
  return {
    running: alive && !stale,
    stale,
    pid: hb.pid,
    web_url: hb.web_url,
    started_at: hb.started_at,
    last_heartbeat: hb.last_heartbeat,
    cron_installed,
    cron_supported,
  };
}

/**
 * Cron-invoked keeper. If a fresh daemon is already running, just stamp
 * the heartbeat. Otherwise, spawn `droidring web` detached, wait briefly
 * for it to publish its URL, and record the new pid.
 *
 * Returns the current web URL (if known) so CLI callers like
 * `droidring launch` don't have to repeat the poll.
 *
 * Never throws — cron swallows output. Logs to service.log via the redirect
 * the cron entry sets up.
 */
export async function ensureDaemon(droidringBin: string): Promise<string | null> {
  const hb = readHeartbeat();
  if (hb && isProcessAlive(hb.pid)) {
    // Live pid: re-stamp regardless of beat age. A stale beat on a live pid
    // just means cron hasn't fired for a while; respawning would collide
    // on the port.
    writeHeartbeat({ pid: hb.pid, web_url: hb.web_url, started_at: hb.started_at });
    return hb.web_url ?? null;
  }
  clearHeartbeat();

  const out = openSync(serviceLogPath(), 'a');
  const child = spawn(droidringBin, ['web'], {
    detached: true,
    stdio: ['ignore', out, out],
    // Headless cron — don't try to pop an Electron window.
    env: { ...process.env, DROIDRING_WEB_OPEN: '0' },
  });
  // Parent's fd is independent of the child's dup — close ours so long-lived
  // callers (e.g. `droidring service install` → ensureDaemon) don't leak it.
  closeSync(out);
  child.unref();
  const pid = child.pid;
  if (!pid) return null;

  // Poll the web-url file rather than the socket — the path is authoritative
  // and cheap to stat. Bail early if the child dies.
  let url: string | null = null;
  for (let i = 0; i < 32; i++) {
    url = readWebUrl();
    if (url) break;
    await new Promise((r) => setTimeout(r, 250));
    if (!isProcessAlive(pid)) break;
  }
  writeHeartbeat({ pid, web_url: url || undefined, started_at: Date.now() });
  return url;
}
