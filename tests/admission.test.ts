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
  admission?: 'open' | 'approval',
): Room {
  const ref: { room?: Room } = {};
  const sink = (env: Envelope) => ref.room!.handleEnvelope(env);
  const room = new Room(
    { name, rootSecret, creatorPubkey, admissionMode: admission },
    identity,
    repo,
    (env) => broker.broadcast(ref.room!.idHex, sink, env),
  );
  ref.room = room;
  broker.register(room.idHex, sink);
  return room;
}

describe('Admission mode', () => {
  it('approval: joiner cannot decrypt until approved', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const rootSecret = randomKey();

    // Alice creates an approval-mode room and rotates so epoch-0 is NOT the msg key.
    const ra = buildRoom('#closed', rootSecret, alice.publicKey, alice, a.repo, broker, 'approval');
    ra.initSelf('alice');
    ra.rotateKey(); // simulate the manager's auto-rotate on approval create
    expect(ra.epoch).toBe(1);

    // Bob joins (sends hello). He does NOT get added to members; request is pending.
    const rb = buildRoom('#closed', rootSecret, alice.publicKey, bob, b.repo, broker, 'approval');
    rb.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    expect(ra.listPending().length).toBe(1);
    expect(ra.members.size).toBe(1); // just Alice

    // Alice sends a message BEFORE approving Bob.
    ra.sendMessage('pre-approval');
    await new Promise((r) => setTimeout(r, 20));
    // Bob does NOT have the post-rotation key, so cannot decrypt.
    expect(b.repo.fetchMessages(rb.idHex, 10).some((m) => m.text === 'pre-approval')).toBe(false);

    // Alice approves.
    const ok = ra.approveJoin(bob.publicKey);
    expect(ok).toBe(true);
    expect(ra.listPending().length).toBe(0);
    expect(ra.members.size).toBe(2);
    await new Promise((r) => setTimeout(r, 30));

    // Bob can now decrypt post-approval messages.
    ra.sendMessage('post-approval');
    await new Promise((r) => setTimeout(r, 20));
    expect(b.repo.fetchMessages(rb.idHex, 10).some((m) => m.text === 'post-approval')).toBe(true);

    a.close();
    b.close();
  });

  it('deny: request is dropped, joiner stays out', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const eve = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const rootSecret = randomKey();

    const ra = buildRoom('#closed', rootSecret, alice.publicKey, alice, a.repo, broker, 'approval');
    ra.initSelf('alice');
    ra.rotateKey();

    const rb = buildRoom('#closed', rootSecret, alice.publicKey, eve, b.repo, broker, 'approval');
    rb.sendHello('eve', 't', '0');
    await new Promise((r) => setTimeout(r, 20));
    expect(ra.listPending().length).toBe(1);

    const denied = ra.denyJoin(eve.publicKey);
    expect(denied).toBe(true);
    expect(ra.listPending().length).toBe(0);
    expect(ra.members.size).toBe(1);

    ra.sendMessage('private');
    await new Promise((r) => setTimeout(r, 20));
    expect(b.repo.fetchMessages(rb.idHex, 10).some((m) => m.text === 'private')).toBe(false);

    a.close();
    b.close();
  });

  it('open mode: joiner gets added automatically (baseline)', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const rootSecret = randomKey();

    const ra = buildRoom('#open', rootSecret, alice.publicKey, alice, a.repo, broker, 'open');
    ra.initSelf('alice');
    const rb = buildRoom('#open', rootSecret, alice.publicKey, bob, b.repo, broker, 'open');
    rb.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    expect(ra.listPending().length).toBe(0);
    expect(ra.members.size).toBe(2);

    a.close();
    b.close();
  });
});
