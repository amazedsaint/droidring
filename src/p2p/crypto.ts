import {
  KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

export { createPublicKey };
import { blake3 as nobleBlake3 } from '@noble/hashes/blake3';
import { hkdf as nobleHkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';

export const ROOM_ID_BYTES = 32;
export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const SIG_BYTES = 64;

export function blake3(data: Uint8Array, outLen = 32): Uint8Array {
  return nobleBlake3(data, { dkLen: outLen });
}

export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, len = 32): Uint8Array {
  return nobleHkdf(sha256, ikm, salt, new TextEncoder().encode(info), len);
}

export function randomNonce(): Uint8Array {
  return new Uint8Array(randomBytes(NONCE_BYTES));
}

export function randomKey(): Uint8Array {
  return new Uint8Array(randomBytes(KEY_BYTES));
}

export function deriveRoomId(name: string, secret: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const merged = new Uint8Array(enc.encode(name).length + secret.length);
  merged.set(enc.encode(name), 0);
  merged.set(secret, enc.encode(name).length);
  return blake3(merged, ROOM_ID_BYTES);
}

export function aeadSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  const aead = new XChaCha20Poly1305(key);
  return aead.seal(nonce, plaintext, aad);
}

export function aeadOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array,
): Uint8Array | null {
  const aead = new XChaCha20Poly1305(key);
  return aead.open(nonce, ciphertext, aad);
}

// Ed25519 identity keys
export function generateIdentity(): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  privateJwk: any;
  publicJwk: any;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const rawPublic = publicKey.export({ format: 'der', type: 'spki' });
  const rawPrivate = privateKey.export({ format: 'der', type: 'pkcs8' });
  // last 32 bytes of the DER SPKI are the raw public key for Ed25519
  return {
    publicKey: new Uint8Array(rawPublic.subarray(rawPublic.length - 32)),
    privateKey: new Uint8Array(rawPrivate.subarray(rawPrivate.length - 32)),
    privateJwk,
    publicJwk,
  };
}

export function edPrivateKeyFromRaw(raw32: Uint8Array): KeyObject {
  // Construct a PKCS8 DER for Ed25519 from the 32-byte seed
  // Ed25519 PKCS8 prefix (16 bytes) then OCTET STRING (0x04 0x20) then 32 bytes seed
  const prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const der = Buffer.concat([prefix, Buffer.from(raw32)]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

export function edPublicKeyFromRaw(raw32: Uint8Array): KeyObject {
  // Ed25519 SPKI prefix (12 bytes) then 32 bytes raw public
  const prefix = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ]);
  const der = Buffer.concat([prefix, Buffer.from(raw32)]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export function edSign(privateKeyRaw: Uint8Array, data: Uint8Array): Uint8Array {
  const key = edPrivateKeyFromRaw(privateKeyRaw);
  return new Uint8Array(sign(null, Buffer.from(data), key));
}

export function edVerify(
  publicKeyRaw: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    const key = edPublicKeyFromRaw(publicKeyRaw);
    return verify(null, Buffer.from(data), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

// X25519 sealed-box style helpers for sender-key exchange.
// We generate an ephemeral X25519 keypair per key_update and derive a shared secret with each recipient's X25519 key.
export function generateX25519Keypair(): { publicKey: Uint8Array; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' });
  return {
    publicKey: new Uint8Array(raw.subarray(raw.length - 32)),
    privateKey,
  };
}

export function x25519PublicKeyFromRaw(raw32: Uint8Array): KeyObject {
  const prefix = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00,
  ]);
  const der = Buffer.concat([prefix, Buffer.from(raw32)]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export function x25519PrivateKeyFromRaw(raw32: Uint8Array): KeyObject {
  const prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
  ]);
  const der = Buffer.concat([prefix, Buffer.from(raw32)]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

export function x25519SharedSecret(privateKey: KeyObject, peerPublicRaw: Uint8Array): Uint8Array {
  const peer = x25519PublicKeyFromRaw(peerPublicRaw);
  return new Uint8Array(diffieHellman({ privateKey, publicKey: peer }));
}

/**
 * Derive a stable X25519 keypair from an Ed25519 identity seed.
 * We hash the Ed25519 private seed + public together with HKDF to get an
 * X25519 scalar. This keeps X25519 persistent across restarts without
 * needing an external library for Ed25519→X25519 conversion.
 */
export function deriveX25519FromIdentity(
  edPrivateRaw: Uint8Array,
  edPublicRaw: Uint8Array,
): {
  privateKey: KeyObject;
  publicKey: Uint8Array;
  privateRaw: Uint8Array;
} {
  const seed = hkdf(edPrivateRaw, edPublicRaw, 'droidring v1 x25519 derive', 32);
  // X25519 requires scalar clamping (top bit unset, etc.). Node accepts any
  // 32-byte value and clamps internally when performing the ECDH.
  const priv = x25519PrivateKeyFromRaw(seed);
  const pubObj = createPublicKey(priv);
  const pubDer = pubObj.export({ format: 'der', type: 'spki' }) as Buffer;
  const pubRaw = new Uint8Array(pubDer.subarray(pubDer.length - 32));
  return { privateKey: priv, publicKey: pubRaw, privateRaw: seed };
}

// Seal a value to a recipient's x25519 public key.
// Output: ephPubkey(32) || nonce(24) || ciphertext
export function sealToX25519(recipientPublicRaw: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const eph = generateX25519Keypair();
  const shared = x25519SharedSecret(eph.privateKey, recipientPublicRaw);
  const key = hkdf(shared, recipientPublicRaw, 'droidring v1 sealed-box', 32);
  const nonce = randomNonce();
  const ct = aeadSeal(key, nonce, plaintext);
  const out = new Uint8Array(32 + NONCE_BYTES + ct.length);
  out.set(eph.publicKey, 0);
  out.set(nonce, 32);
  out.set(ct, 32 + NONCE_BYTES);
  return out;
}

export function openSealedBox(
  recipientPrivate: KeyObject,
  recipientPublicRaw: Uint8Array,
  sealed: Uint8Array,
): Uint8Array | null {
  if (sealed.length < 32 + NONCE_BYTES + 16) return null;
  const ephPub = sealed.subarray(0, 32);
  const nonce = sealed.subarray(32, 32 + NONCE_BYTES);
  const ct = sealed.subarray(32 + NONCE_BYTES);
  const shared = x25519SharedSecret(recipientPrivate, ephPub);
  const key = hkdf(shared, recipientPublicRaw, 'droidring v1 sealed-box', 32);
  return aeadOpen(key, nonce, ct);
}

// Helpers
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(data)).digest('hex');
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
