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

describe('Notes', () => {
  it('note_put roundtrips across two peers', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const rootSecret = randomKey();

    const ra = buildRoom('#notes', rootSecret, alice.publicKey, alice, a.repo, broker);
    ra.initSelf('alice');
    const rb = buildRoom('#notes', rootSecret, alice.publicKey, bob, b.repo, broker);
    rb.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    const { id } = ra.putNote({ title: 'Plan', body: 'step 1\nstep 2', tags: ['design'] });
    await new Promise((r) => setTimeout(r, 20));

    const fromBob = b.repo.getNote(rb.idHex, id);
    expect(fromBob).toBeDefined();
    expect(fromBob!.title).toBe('Plan');
    expect(fromBob!.body).toBe('step 1\nstep 2');
    expect(fromBob!.tags).toEqual(['design']);

    a.close();
    b.close();
  });

  it('LWW: older replay of a put is rejected', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const rootSecret = randomKey();

    const ra = buildRoom('#lww', rootSecret, alice.publicKey, alice, a.repo, broker);
    ra.initSelf('alice');
    const rb = buildRoom('#lww', rootSecret, alice.publicKey, bob, b.repo, broker);
    rb.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    // Alice writes at t=1000 (direct store call to control ts)
    a.repo.applyNotePut({
      room_id: ra.idHex,
      id: 'n1',
      author: Buffer.from(alice.publicKey).toString('hex'),
      title: 'v2',
      body: 'newer',
      tags: [],
      updated_at: 2000,
    });
    // Earlier ts should be rejected
    const accepted = a.repo.applyNotePut({
      room_id: ra.idHex,
      id: 'n1',
      author: Buffer.from(alice.publicKey).toString('hex'),
      title: 'v1',
      body: 'older',
      tags: [],
      updated_at: 1000,
    });
    expect(accepted).toBe(false);
    const cur = a.repo.getNote(ra.idHex, 'n1');
    expect(cur!.title).toBe('v2');

    a.close();
    b.close();
  });

  it('delete creates a tombstone that survives later older put', async () => {
    const { repo } = tmpDb();
    repo.applyNotePut({
      room_id: 'r',
      id: 'n',
      author: 'alice',
      title: 't',
      body: 'b',
      tags: [],
      updated_at: 100,
    });
    repo.applyNoteDelete({ room_id: 'r', id: 'n', deleted_at: 200 });
    const accepted = repo.applyNotePut({
      room_id: 'r',
      id: 'n',
      author: 'alice',
      title: 'resurrect',
      body: 'b',
      tags: [],
      updated_at: 150,
    });
    expect(accepted).toBe(false);
    const got = repo.getNote('r', 'n');
    expect(got!.deleted).toBe(true);
  });
});

describe('Inbound validation', () => {
  it('drops an oversized note_put from a malicious peer', async () => {
    // Two peers share a room. Bob sends a legit note, then sends a 10 MB note
    // that bypasses our tool-level caps (direct Room.putNote at the wire layer).
    // Alice's handleEnvelope must reject it.
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const rootSecret = randomKey();

    const ra = buildRoom('#dos', rootSecret, alice.publicKey, alice, a.repo, broker);
    ra.initSelf('alice');
    const rb = buildRoom('#dos', rootSecret, alice.publicKey, bob, b.repo, broker);
    rb.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    // Legit note goes through.
    rb.putNote({ id: 'good', title: 'ok', body: 'small', tags: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(a.repo.getNote(ra.idHex, 'good')?.body).toBe('small');

    // Oversized: 200 KB body — past the 64 KB inbound cap.
    const huge = 'x'.repeat(200_000);
    rb.putNote({ id: 'huge', title: 'big', body: huge, tags: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(a.repo.getNote(ra.idHex, 'huge')).toBeUndefined();

    a.close();
    b.close();
  });

  it('drops a graph_assert batch larger than the cap', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const rootSecret = randomKey();

    const ra = buildRoom('#bulk', rootSecret, alice.publicKey, alice, a.repo, broker);
    ra.initSelf('alice');
    const rb = buildRoom('#bulk', rootSecret, alice.publicKey, bob, b.repo, broker);
    rb.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    // 500 triples — past the 100-triple inbound cap.
    const triples = [] as Array<{ src: string; predicate: string; dst: string }>;
    for (let i = 0; i < 500; i++)
      triples.push({ src: `n${i}`, predicate: 'rel', dst: `n${i + 1}` });
    rb.assertTriples(triples);
    await new Promise((r) => setTimeout(r, 30));

    // Alice must have zero triples — the batch was rejected wholesale.
    expect(a.repo.queryGraph(ra.idHex, {}).length).toBe(0);

    a.close();
    b.close();
  });
});

describe('Knowledge graph', () => {
  it('assert + query across two peers', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const rootSecret = randomKey();

    const ra = buildRoom('#kg', rootSecret, alice.publicKey, alice, a.repo, broker);
    ra.initSelf('alice');
    const rb = buildRoom('#kg', rootSecret, alice.publicKey, bob, b.repo, broker);
    rb.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    ra.assertTriples([
      {
        src: 'svc-A',
        predicate: 'depends_on',
        dst: 'svc-B',
        src_type: 'service',
        dst_type: 'service',
      },
      { src: 'svc-B', predicate: 'depends_on', dst: 'svc-C' },
    ]);
    await new Promise((r) => setTimeout(r, 20));

    const out = b.repo.queryGraph(rb.idHex, { predicate: 'depends_on' });
    expect(out.length).toBe(2);
    const neighbors = b.repo.neighbors(rb.idHex, 'svc-A', 2);
    expect(neighbors.nodes).toContain('svc-A');
    expect(neighbors.nodes).toContain('svc-C');

    a.close();
    b.close();
  });

  it('retract removes from query results', async () => {
    const broker = new InMemoryBroker();
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const rootSecret = randomKey();
    const ra = buildRoom('#kg2', rootSecret, alice.publicKey, alice, a.repo, broker);
    ra.initSelf('alice');
    const rb = buildRoom('#kg2', rootSecret, alice.publicKey, bob, b.repo, broker);
    rb.sendHello('bob', 't', '0');
    await new Promise((r) => setTimeout(r, 20));

    const { ids } = ra.assertTriples([{ src: 'a', predicate: 'owns', dst: 'b' }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(b.repo.queryGraph(rb.idHex, {}).length).toBe(1);

    ra.retractTriples(ids);
    await new Promise((r) => setTimeout(r, 20));
    expect(b.repo.queryGraph(rb.idHex, {}).length).toBe(0);

    a.close();
    b.close();
  });
});
