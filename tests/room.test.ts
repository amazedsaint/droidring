import { describe, expect, it } from 'vitest';
import { randomKey } from '../src/p2p/crypto.js';
import type { Envelope } from '../src/p2p/envelope.js';
import { Room } from '../src/p2p/room.js';
import { InMemoryBroker, makeIdentity, tmpDb } from './helpers.js';

function buildRoom(
  name: string,
  rootSecret: Uint8Array,
  creatorPubkey: Uint8Array,
  identity: any,
  repo: any,
  broker: InMemoryBroker,
): Room {
  const ref: { room?: Room } = {};
  const sink = (env: Envelope) => ref.room!.handleEnvelope(env);
  const room = new Room({ name, rootSecret, creatorPubkey }, identity, repo, (env) =>
    broker.broadcast(ref.room!.idHex, sink, env),
  );
  ref.room = room;
  broker.register(room.idHex, sink);
  return room;
}

describe('Room two-peer loopback', () => {
  it('two peers exchange messages and share membership', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();

    const rootSecret = randomKey();
    const roomName = '#general';

    const roomA = buildRoom(roomName, rootSecret, alice.publicKey, alice, a.repo, broker);
    roomA.initSelf('alice');

    const roomB = buildRoom(roomName, rootSecret, alice.publicKey, bob, b.repo, broker);
    roomB.sendHello('bob', 'test', '0.0.0');

    // Let hello/members flow settle
    await new Promise((r) => setTimeout(r, 20));

    expect(roomA.members.size).toBe(2);
    expect(roomB.members.size).toBe(2);

    for (let i = 0; i < 5; i++) {
      roomA.sendMessage(`a-${i}`);
      roomB.sendMessage(`b-${i}`);
    }
    await new Promise((r) => setTimeout(r, 30));

    const aMsgs = a.repo.fetchMessages(roomA.idHex, 50);
    const bMsgs = b.repo.fetchMessages(roomB.idHex, 50);
    expect(aMsgs.length).toBe(10);
    expect(bMsgs.length).toBe(10);

    const aTexts = aMsgs.map((m) => m.text).sort();
    const bTexts = bMsgs.map((m) => m.text).sort();
    expect(aTexts).toEqual(bTexts);

    a.close();
    b.close();
  });

  it('newcomer joining after a rotation can still decrypt new messages', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const carol = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const c = tmpDb();

    const rootSecret = randomKey();
    const roomName = '#late-joiner';

    const roomA = buildRoom(roomName, rootSecret, alice.publicKey, alice, a.repo, broker);
    roomA.initSelf('alice');
    const roomB = buildRoom(roomName, rootSecret, alice.publicKey, bob, b.repo, broker);
    roomB.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    // Rotate before Carol joins
    roomA.kick(bob.publicKey);
    await new Promise((r) => setTimeout(r, 20));
    expect(roomA.epoch).toBeGreaterThan(0);

    // Carol joins AFTER rotation — only has epoch-0 key from ticket.
    const roomC = buildRoom(roomName, rootSecret, alice.publicKey, carol, c.repo, broker);
    roomC.sendHello('carol', 't', '0');
    await new Promise((r) => setTimeout(r, 30));

    // Carol should have been caught up.
    expect(roomC.epoch).toBeGreaterThan(0);

    // Alice sends a post-rotation message; Carol decodes it.
    roomA.sendMessage('after-rotation');
    await new Promise((r) => setTimeout(r, 30));

    const cMsgs = c.repo.fetchMessages(roomC.idHex, 50);
    expect(cMsgs.some((m) => m.text === 'after-rotation')).toBe(true);

    a.close();
    b.close();
    c.close();
  });

  it('forged kick from a non-creator is silently dropped', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity(); // creator
    const bob = makeIdentity();
    const carol = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const c = tmpDb();
    const rootSecret = randomKey();
    const roomName = '#no-forge';

    const roomA = buildRoom(roomName, rootSecret, alice.publicKey, alice, a.repo, broker);
    roomA.initSelf('alice');
    const roomB = buildRoom(roomName, rootSecret, alice.publicKey, bob, b.repo, broker);
    roomB.sendHello('bob', 't', '0');
    const roomC = buildRoom(roomName, rootSecret, alice.publicKey, carol, c.repo, broker);
    roomC.sendHello('carol', 't', '0');
    await new Promise((r) => setTimeout(r, 30));
    expect(roomA.members.size).toBe(3);

    // Bob (not the creator) attempts to kick Carol. The local guard throws
    // first; if a malicious build bypassed that guard, the envelope would be
    // dropped by Alice and Carol on receipt anyway.
    expect(() => roomB.kick(carol.publicKey)).toThrow(/creator/i);

    // Nobody was kicked.
    expect(roomA.members.size).toBe(3);
    expect(roomC.members.size).toBe(3);

    a.close();
    b.close();
    c.close();
  });

  it('kick + key rotation: kicked peer cannot decrypt subsequent messages', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const carol = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const c = tmpDb();

    const rootSecret = randomKey();
    const roomName = '#review';

    const roomA = buildRoom(roomName, rootSecret, alice.publicKey, alice, a.repo, broker);
    roomA.initSelf('alice');
    const roomB = buildRoom(roomName, rootSecret, alice.publicKey, bob, b.repo, broker);
    roomB.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    const roomC = buildRoom(roomName, rootSecret, alice.publicKey, carol, c.repo, broker);
    roomC.sendHello('carol', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    expect(roomA.members.size).toBe(3);
    expect(roomB.members.size).toBe(3);
    expect(roomC.members.size).toBe(3);

    // Alice kicks Bob, rotates key.
    roomA.kick(bob.publicKey);
    await new Promise((r) => setTimeout(r, 30));

    // Alice sends a message on the new epoch.
    roomA.sendMessage('post-rotate');
    await new Promise((r) => setTimeout(r, 30));

    // Carol sees it.
    const cMsgs = c.repo.fetchMessages(roomC.idHex, 50);
    expect(cMsgs.some((m) => m.text === 'post-rotate')).toBe(true);

    // Bob does not.
    const bMsgs = b.repo.fetchMessages(roomB.idHex, 50);
    expect(bMsgs.some((m) => m.text === 'post-rotate')).toBe(false);

    a.close();
    b.close();
    c.close();
  });
});
