import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { droidringDir, writeSecretFile } from '../p2p/identity.js';

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
  // The URL embeds the auth token, so it's secret — 0600 like web-token.
  writeSecretFile(webUrlPath(), `${url}\n`);
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
