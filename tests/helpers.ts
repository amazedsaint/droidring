import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateIdentity } from '../src/p2p/crypto.js';
import type { Envelope } from '../src/p2p/envelope.js';
import { Identity } from '../src/p2p/identity.js';
import { openDatabase } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';

export function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'droidring-test-'));
  const db = openDatabase(join(dir, 'store.db'));
  return { repo: new Repo(db), dir, close: () => db.close() };
}

export function makeIdentity(): Identity {
  const { publicKey, privateKey } = generateIdentity();
  return new Identity(publicKey, privateKey);
}

/** In-memory broker that fans out envelopes to all rooms registered with it. */
export class InMemoryBroker extends EventEmitter {
  private sinks = new Map<string, Array<(env: Envelope) => void>>();

  register(roomIdHex: string, sink: (env: Envelope) => void): void {
    const arr = this.sinks.get(roomIdHex) || [];
    arr.push(sink);
    this.sinks.set(roomIdHex, arr);
  }

  broadcast(roomIdHex: string, origin: (env: Envelope) => void, env: Envelope): void {
    const arr = this.sinks.get(roomIdHex) || [];
    for (const s of arr) if (s !== origin) s(env);
  }
}
