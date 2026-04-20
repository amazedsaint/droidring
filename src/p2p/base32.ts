// RFC 4648 base32 (no padding), lowercase for tickets/pubkeys.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ALPHABET_MAP = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) ALPHABET_MAP.set(ALPHABET[i], i);

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const s = input.toLowerCase().replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = ALPHABET_MAP.get(ch);
    if (idx === undefined) throw new Error(`invalid base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
