import { chmodSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { droidringDir } from '../p2p/identity.js';

/**
 * Persist the current web UI URL (including the token fragment) to a
 * well-known file so users can always discover it after the fact — even
 * when stderr is swallowed by their MCP client and the auto-browser-open
 * fails.
 */

export function webUrlPath(): string {
  return join(droidringDir(), 'web-url');
}

export function writeWebUrl(url: string): void {
  const path = webUrlPath();
  writeFileSync(path, `${url}\n`);
  // Same posture as web-token: the URL embeds the token, so protect it
  // the same way.
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows filesystems don't honour chmod — the file is still in the
    // user's home, which is the strongest defence we have there.
  }
}

export function readWebUrl(): string | null {
  try {
    return readFileSync(webUrlPath(), 'utf8').trim();
  } catch {
    return null;
  }
}

export function clearWebUrl(): void {
  try {
    unlinkSync(webUrlPath());
  } catch {
    /* ignore */
  }
}
