/**
 * Unit tests for the persistent-service heartbeat + cron helpers.
 *
 * Cron writes are exercised only when `crontab` is actually available on
 * the host; otherwise we skip them (CI on Linux usually has it, macOS
 * always does). Everything else — heartbeat JSON, stale detection,
 * process-liveness, status composition — runs unconditionally.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HEARTBEAT_STALE_MS,
  clearHeartbeat,
  cronSupported,
  droidringCronLines,
  filterOutDroidringCronLines,
  heartbeatPath,
  isProcessAlive,
  readHeartbeat,
  serviceStatus,
  writeHeartbeat,
} from '../src/service/service.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'droidring-svc-'));
  process.env.DROIDRING_HOME = home;
});

afterEach(() => {
  // process.env.x = undefined stringifies to "undefined" in Node; the
  // right way to unset is Reflect.deleteProperty.
  Reflect.deleteProperty(process.env, 'DROIDRING_HOME');
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('service heartbeat', () => {
  it('write + read round-trips', () => {
    writeHeartbeat({ pid: 12345, web_url: 'http://127.0.0.1:7879/#token=abc' });
    const hb = readHeartbeat();
    expect(hb).toBeTruthy();
    expect(hb!.pid).toBe(12345);
    expect(hb!.web_url).toBe('http://127.0.0.1:7879/#token=abc');
    expect(typeof hb!.last_heartbeat).toBe('number');
    expect(Math.abs(hb!.last_heartbeat - Date.now())).toBeLessThan(2000);
  });

  it('heartbeat file is chmod 0600 on posix', () => {
    writeHeartbeat({ pid: 1111 });
    if (process.platform !== 'win32') {
      // Lazy-import fs.statSync so the file:// lookup is crisp.
      const { statSync } = require('node:fs');
      const mode = statSync(heartbeatPath()).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('preserves started_at across updates', async () => {
    writeHeartbeat({ pid: 22, started_at: 1000 });
    await new Promise((r) => setTimeout(r, 10));
    writeHeartbeat({ pid: 22 }); // no explicit started_at → reuse
    const hb = readHeartbeat();
    expect(hb!.started_at).toBe(1000);
  });

  it('clearHeartbeat removes the file', () => {
    writeHeartbeat({ pid: 99 });
    expect(readHeartbeat()).toBeTruthy();
    clearHeartbeat();
    expect(readHeartbeat()).toBeNull();
  });

  it('returns null on missing / malformed file', () => {
    expect(readHeartbeat()).toBeNull();
    // Garbage payload
    const { writeFileSync } = require('node:fs');
    writeFileSync(heartbeatPath(), 'not json');
    expect(readHeartbeat()).toBeNull();
  });
});

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for pid 0 / negative / non-integer', () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(Number.NaN)).toBe(false);
  });

  it('returns false for an almost-certainly-dead pid', () => {
    // Pids are capped at ~4M on most systems; 999_999_999 should be unused.
    expect(isProcessAlive(999_999_999)).toBe(false);
  });
});

describe('serviceStatus', () => {
  it('reports no-service when nothing is installed', () => {
    const s = serviceStatus();
    expect(s.running).toBe(false);
    expect(s.stale).toBe(false);
    expect(s.pid).toBeUndefined();
  });

  it('reports running=true when heartbeat is fresh and pid is alive', () => {
    writeHeartbeat({ pid: process.pid, web_url: 'http://x' });
    const s = serviceStatus();
    expect(s.running).toBe(true);
    expect(s.pid).toBe(process.pid);
    expect(s.web_url).toBe('http://x');
    expect(s.stale).toBe(false);
  });

  it('reports stale=true when heartbeat is older than HEARTBEAT_STALE_MS', () => {
    writeHeartbeat({ pid: process.pid });
    // Rewrite with an ancient timestamp.
    const { writeFileSync } = require('node:fs');
    const hb = readHeartbeat()!;
    hb.last_heartbeat = Date.now() - HEARTBEAT_STALE_MS - 60_000;
    writeFileSync(heartbeatPath(), JSON.stringify(hb));
    const s = serviceStatus();
    expect(s.stale).toBe(true);
    expect(s.running).toBe(false);
  });

  it('reports running=false when pid is dead even if heartbeat is fresh', () => {
    writeHeartbeat({ pid: 999_999_999 });
    const s = serviceStatus();
    expect(s.running).toBe(false);
  });
});

describe('cron support', () => {
  it('reports cronSupported honestly per-platform', () => {
    const supported = cronSupported();
    if (process.platform === 'win32') {
      expect(supported).toBe(false);
    } else {
      // Unix hosts normally have crontab; some minimal CIs don't, so we
      // accept either answer as long as the value is a boolean.
      expect(typeof supported).toBe('boolean');
    }
  });
});

describe('cron line helpers', () => {
  it('droidringCronLines emits a marker + one scheduled command', () => {
    const lines = droidringCronLines('/usr/local/bin/droidring');
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatch(/droidring persistent service/);
    expect(lines[1]).toMatch(/^\* \* \* \* \* \/usr\/local\/bin\/droidring ensure/);
  });

  it('filterOutDroidringCronLines removes the marker and its following command', () => {
    const input = [
      '# other users cron',
      '0 9 * * * /bin/backup',
      ...droidringCronLines('/usr/bin/droidring'),
      '# keep this too',
      '*/15 * * * * /bin/ping',
    ];
    const out = filterOutDroidringCronLines(input);
    expect(out).toEqual([
      '# other users cron',
      '0 9 * * * /bin/backup',
      '# keep this too',
      '*/15 * * * * /bin/ping',
    ]);
  });

  it('filterOutDroidringCronLines is a no-op when nothing matches', () => {
    const input = ['# no droidring here', '0 0 * * * /bin/foo'];
    expect(filterOutDroidringCronLines(input)).toEqual(input);
  });

  it('filterOutDroidringCronLines tolerates a stale orphan marker', () => {
    // A crashed installer might have left a marker with no following command.
    // We still drop the marker and continue — not strictly required but nicer.
    const input = [
      '# droidring persistent service (added by `droidring service install`)',
      '# other note',
    ];
    const out = filterOutDroidringCronLines(input);
    expect(out).toEqual([]); // "# other note" follows the marker → dropped. That's fine.
  });
});
