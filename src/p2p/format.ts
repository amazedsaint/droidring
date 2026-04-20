import { base32Decode } from './base32.js';

/**
 * Wire-format helpers shared between MCP tools, REST API, and WS broadcast.
 * Kept in one place so pubkey/member/message representations don't drift
 * across interfaces (earlier versions shipped base32 in MCP responses and
 * hex in REST responses for the same fields).
 */

export function bytesToHex(u: Uint8Array): string {
  return Buffer.from(u).toString('hex');
}

/** Decode a base32 string to hex. Falls back to the input on decode failure
 * (useful for legacy rows that may already be hex). */
export function base32ToHex(s: string): string {
  try {
    return bytesToHex(base32Decode(s));
  } catch {
    return s;
  }
}

/** Accept either a 64-char hex pubkey or a base32 pubkey, return 32 raw bytes
 * or null on any format / length failure. */
export function parsePubkey(s: string): Uint8Array | null {
  try {
    const u = /^[0-9a-f]{64}$/i.test(s) ? new Uint8Array(Buffer.from(s, 'hex')) : base32Decode(s);
    return u.length === 32 ? u : null;
  } catch {
    return null;
  }
}
