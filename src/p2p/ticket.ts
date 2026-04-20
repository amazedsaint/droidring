import { base32Decode, base32Encode } from './base32.js';
import { concatBytes } from './crypto.js';

// Ticket binary layout (v1):
//   magic:   "ACT1"         4 bytes
//   nameLen: u16 BE          2 bytes
//   name:    utf8 bytes      nameLen
//   secret:                  32 bytes
//   bootLen: u8              1 byte
//   bootN × (pubkey 32):     32 × bootLen
// Total base32 length for typical name: ~90-130 chars.

export interface Ticket {
  roomName: string;
  rootSecret: Uint8Array;
  bootstrapPubkeys: Uint8Array[];
}

const MAGIC = new TextEncoder().encode('ACT1');

export function encodeTicket(t: Ticket): string {
  const nameBytes = new TextEncoder().encode(t.roomName);
  if (nameBytes.length > 0xffff) throw new Error('room name too long');
  if (t.rootSecret.length !== 32) throw new Error('rootSecret must be 32 bytes');
  if (t.bootstrapPubkeys.length > 255) throw new Error('too many bootstrap peers');
  for (const k of t.bootstrapPubkeys) {
    if (k.length !== 32) throw new Error('bootstrap pubkey must be 32 bytes');
  }

  const nameLen = new Uint8Array(2);
  new DataView(nameLen.buffer).setUint16(0, nameBytes.length, false);
  const bootLen = new Uint8Array([t.bootstrapPubkeys.length]);
  const parts: Uint8Array[] = [
    MAGIC,
    nameLen,
    nameBytes,
    t.rootSecret,
    bootLen,
    ...t.bootstrapPubkeys,
  ];
  return base32Encode(concatBytes(...parts));
}

export function decodeTicket(input: string): Ticket {
  const buf = base32Decode(input);
  let off = 0;
  const magic = buf.subarray(off, off + 4);
  off += 4;
  if (
    magic[0] !== MAGIC[0] ||
    magic[1] !== MAGIC[1] ||
    magic[2] !== MAGIC[2] ||
    magic[3] !== MAGIC[3]
  ) {
    throw new Error('bad ticket magic');
  }
  if (buf.length < off + 2) throw new Error('ticket truncated');
  const view = new DataView(buf.buffer, buf.byteOffset);
  const nameLen = view.getUint16(off, false);
  off += 2;
  if (buf.length < off + nameLen + 32 + 1) throw new Error('ticket truncated');
  const name = new TextDecoder().decode(buf.subarray(off, off + nameLen));
  off += nameLen;
  const secret = buf.subarray(off, off + 32);
  off += 32;
  const bootLen = buf[off];
  off += 1;
  if (buf.length < off + bootLen * 32) throw new Error('ticket truncated');
  const bootstrap: Uint8Array[] = [];
  for (let i = 0; i < bootLen; i++) {
    bootstrap.push(buf.subarray(off, off + 32));
    off += 32;
  }
  return {
    roomName: name,
    rootSecret: new Uint8Array(secret),
    bootstrapPubkeys: bootstrap.map((b) => new Uint8Array(b)),
  };
}
