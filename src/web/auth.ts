import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { droingringDir } from '../p2p/identity.js';

/**
 * The web UI authenticates every request with a Bearer token. The token is
 * generated on first run, stored at ~/.droingring/web-token (0600), and
 * printed to stderr so the user can copy it. Because we require a header
 * (not a cookie) and bind to 127.0.0.1 by default, CSRF is not a concern —
 * a cross-origin website can't read the token.
 */

export function tokenPath(): string {
  return join(droingringDir(), 'web-token');
}

export function loadOrCreateToken(): string {
  const path = tokenPath();
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(path, `${token}\n`);
  chmodSync(path, 0o600);
  return token;
}

/** Constant-time token compare. */
export function verifyToken(expected: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function extractBearer(
  authHeader: string | undefined,
  urlToken: string | undefined,
): string | undefined {
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
  if (urlToken) return urlToken;
  return undefined;
}
