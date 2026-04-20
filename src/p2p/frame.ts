import { decode as cborDecode, encode as cborEncode } from 'cbor-x';

// length-prefixed (u32 BE) CBOR frames over a duplex stream.
export function encodeFrame(obj: unknown): Buffer {
  const payload = cborEncode(obj);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class FrameParser {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: Buffer[] = [];
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len > 10 * 1024 * 1024) throw new Error('frame too large');
      if (this.buf.length < 4 + len) break;
      out.push(this.buf.subarray(4, 4 + len));
      this.buf = this.buf.subarray(4 + len);
    }
    return out;
  }
}

export function decodeFrame<T = unknown>(payload: Buffer): T {
  return cborDecode(payload) as T;
}
