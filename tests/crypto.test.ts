import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode } from '../src/p2p/base32.js';
import {
  aeadOpen,
  aeadSeal,
  edSign,
  edVerify,
  generateIdentity,
  generateX25519Keypair,
  hkdf,
  openSealedBox,
  randomKey,
  randomNonce,
  sealToX25519,
  x25519PrivateKeyFromRaw,
} from '../src/p2p/crypto.js';

describe('crypto', () => {
  it('AEAD seal/open roundtrip', () => {
    const k = randomKey();
    const n = randomNonce();
    const pt = new TextEncoder().encode('hello world');
    const ct = aeadSeal(k, n, pt, new Uint8Array([1, 2, 3]));
    const back = aeadOpen(k, n, ct, new Uint8Array([1, 2, 3]));
    expect(back).not.toBeNull();
    expect(new TextDecoder().decode(back!)).toBe('hello world');
    // wrong aad fails
    expect(aeadOpen(k, n, ct, new Uint8Array([9]))).toBeNull();
  });

  it('ed25519 sign/verify', () => {
    const id = generateIdentity();
    const msg = new TextEncoder().encode('test');
    const sig = edSign(id.privateKey, msg);
    expect(edVerify(id.publicKey, msg, sig)).toBe(true);
    const bad = new Uint8Array(sig);
    bad[0] ^= 1;
    expect(edVerify(id.publicKey, msg, bad)).toBe(false);
  });

  it('hkdf deterministic', () => {
    const k1 = hkdf(new Uint8Array([1, 2, 3]), new Uint8Array([4]), 'info');
    const k2 = hkdf(new Uint8Array([1, 2, 3]), new Uint8Array([4]), 'info');
    expect(Buffer.from(k1).equals(Buffer.from(k2))).toBe(true);
  });

  it('base32 roundtrip', () => {
    const b = new Uint8Array([0, 1, 2, 3, 4, 5, 255, 254, 253]);
    const s = base32Encode(b);
    expect(Buffer.from(base32Decode(s)).equals(Buffer.from(b))).toBe(true);
  });

  it('sealed box to x25519 recipient', () => {
    const recipient = generateX25519Keypair();
    const pkcs8 = recipient.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
    const recipientPrivRaw = new Uint8Array(pkcs8.subarray(pkcs8.length - 32));

    const secret = randomKey();
    const sealed = sealToX25519(recipient.publicKey, secret);
    const priv = x25519PrivateKeyFromRaw(recipientPrivRaw);
    const opened = openSealedBox(priv, recipient.publicKey, sealed);
    expect(opened).not.toBeNull();
    expect(Buffer.from(opened!).equals(Buffer.from(secret))).toBe(true);
  });
});
