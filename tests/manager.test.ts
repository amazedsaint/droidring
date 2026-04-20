import { describe, expect, it } from 'vitest';
import { RoomManager } from '../src/p2p/manager.js';
import { Swarm } from '../src/p2p/swarm.js';
import { makeIdentity, tmpDb } from './helpers.js';

class FakeSwarm extends Swarm {
  override async start(): Promise<void> {}
  override async joinTopic(): Promise<void> {}
  override async leaveTopic(): Promise<void> {}
  override broadcast(): void {}
  override async destroy(): Promise<void> {}
}

describe('RoomManager', () => {
  it('derives the same DM room id from both sides', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const mgrA = new RoomManager({
      identity: alice,
      repo: a.repo,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    const mgrB = new RoomManager({
      identity: bob,
      repo: b.repo,
      nickname: 'b',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await mgrA.start();
    await mgrB.start();

    const ra = await mgrA.openDM(bob.publicKey);
    const rb = await mgrB.openDM(alice.publicKey);
    expect(ra.idHex).toBe(rb.idHex);
    expect(ra.name).toBe(rb.name);
    expect(Buffer.from(ra.rootSecret).equals(Buffer.from(rb.rootSecret))).toBe(true);

    a.close();
    b.close();
  });

  it('refuses to DM yourself', async () => {
    const me = makeIdentity();
    const { repo } = tmpDb();
    const mgr = new RoomManager({
      identity: me,
      repo,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await mgr.start();
    await expect(mgr.openDM(me.publicKey)).rejects.toThrow(/yourself/);
  });

  it('rooms survive restart (schema + key reload)', async () => {
    const alice = makeIdentity();
    const { repo, dir, close } = tmpDb();
    const mgr1 = new RoomManager({
      identity: alice,
      repo,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await mgr1.start();
    const r = await mgr1.createRoom('#persist');
    const roomId = r.idHex;
    close();

    // Reopen the same db
    const { openDatabase } = await import('../src/store/db.js');
    const { Repo } = await import('../src/store/repo.js');
    const db2 = openDatabase(`${dir}/store.db`);
    const repo2 = new Repo(db2);
    const mgr2 = new RoomManager({
      identity: alice,
      repo: repo2,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await mgr2.start();
    expect(mgr2.rooms.has(roomId)).toBe(true);
    const restored = mgr2.rooms.get(roomId)!;
    expect(restored.name).toBe('#persist');
    db2.close();
  });

  it('ticket create + join roundtrips through manager', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();
    const mgrA = new RoomManager({
      identity: alice,
      repo: a.repo,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    const mgrB = new RoomManager({
      identity: bob,
      repo: b.repo,
      nickname: 'b',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await mgrA.start();
    await mgrB.start();

    const ra = await mgrA.createRoom('#together');
    const ticket = ra.toTicket();
    const rb = await mgrB.joinByTicket(ticket);
    expect(rb.idHex).toBe(ra.idHex);
    a.close();
    b.close();
  });
});
