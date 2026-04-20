import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/**
 * Minimal RFC 6455 WebSocket server — just enough to accept a client and
 * broadcast JSON text frames. We don't need the full spec (no extensions,
 * no fragmentation on send, no compression). A single WS connection per
 * UI tab is the expected load.
 */

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WsConnection {
  id: string;
  send(obj: unknown): void;
  /** Send a pre-serialised JSON string; saves a stringify per client in broadcasts. */
  sendRaw(text: string): void;
  close(): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
}

interface Listener {
  message: Array<(data: unknown) => void>;
  close: Array<() => void>;
}

export function acceptWebSocket(req: IncomingMessage, socket: Duplex): WsConnection | null {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1')
    .update(String(key) + WS_MAGIC)
    .digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  const listeners: Listener = { message: [], close: [] };
  let buffer = Buffer.alloc(0);
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      socket.end(encodeCloseFrame());
    } catch {
      /* ignore */
    }
    for (const cb of listeners.close) cb();
  };

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = tryDecodeFrame(buffer);
      if (!frame) break;
      buffer = buffer.subarray(frame.consumed);
      if (frame.opcode === 0x8) {
        close();
        return;
      }
      if (frame.opcode === 0x9) {
        // ping -> pong
        try {
          socket.write(encodeFrame(0xa, frame.payload));
        } catch {
          /* ignore */
        }
        continue;
      }
      if (frame.opcode === 0x1) {
        try {
          const text = frame.payload.toString('utf8');
          const obj = JSON.parse(text);
          for (const cb of listeners.message) cb(obj);
        } catch {
          // malformed frames are ignored
        }
      }
    }
  });
  socket.on('close', () => {
    if (!closed) {
      closed = true;
      for (const cb of listeners.close) cb();
    }
  });
  socket.on('error', () => close());

  const writeText = (text: string) => {
    if (closed) return;
    try {
      socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')));
    } catch {
      close();
    }
  };
  return {
    id: randomBytes(8).toString('hex'),
    send(obj: unknown) {
      writeText(JSON.stringify(obj));
    },
    sendRaw: writeText,
    close,
    on(event: 'message' | 'close', cb: any) {
      listeners[event].push(cb);
    },
  };
}

function tryDecodeFrame(buf: Buffer): { opcode: number; payload: Buffer; consumed: number } | null {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < off + 2) return null;
    len = buf.readUInt16BE(off);
    off += 2;
  } else if (len === 127) {
    if (buf.length < off + 8) return null;
    const hi = buf.readUInt32BE(off);
    const lo = buf.readUInt32BE(off + 4);
    if (hi !== 0) return null; // too large
    len = lo;
    off += 8;
  }
  if (len > 1024 * 1024) return null; // 1 MB cap per frame
  let maskKey: Buffer | null = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    maskKey = buf.subarray(off, off + 4);
    off += 4;
  }
  if (buf.length < off + len) return null;
  let payload = buf.subarray(off, off + len);
  if (maskKey) {
    const unmasked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
    payload = unmasked;
  }
  return { opcode, payload, consumed: off + len };
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

function encodeCloseFrame(): Buffer {
  return Buffer.from([0x88, 0x00]);
}
