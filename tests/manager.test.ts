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

  it('creator leaveRoom closes the room; re-joining via ticket is refused', async () => {
    const alice = makeIdentity();
    const a = tmpDb();
    const mgrA = new RoomManager({
      identity: alice,
      repo: a.repo,
      nickname: 'alice',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await mgrA.start();

    const room = await mgrA.createRoom('#zoom');
    const ticket = room.toTicket();
    expect(a.repo.isRoomClosed(room.idHex)).toBe(false);

    await mgrA.leaveRoom(room.idHex);
    expect(a.repo.isRoomClosed(room.idHex)).toBe(true);

    await expect(mgrA.joinByTicket(ticket)).rejects.toThrow(/closed/);

    a.close();
  });

  it('self_kicked tears down the room: drops from manager + marks left', async () => {
    const alice = makeIdentity();
    const { repo } = tmpDb();
    const mgr = new RoomManager({
      identity: alice,
      repo,
      nickname: 'alice',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await mgr.start();
    const room = await mgr.createRoom('#kickme');
    // Simulate receiving the creator-signed kick targeting us by emitting
    // 'self_kicked' directly — the envelope path is covered elsewhere.
    let emitted = false;
    mgr.on('room_kicked', (info: { room_id: string }) => {
      if (info.room_id === room.idHex) emitted = true;
    });
    room.emit('self_kicked');
    expect(emitted).toBe(true);
    expect(mgr.rooms.has(room.idHex)).toBe(false);
    // listRooms filters left_at IS NULL; after markRoomLeft it's excluded.
    expect(repo.listRooms().some((r) => r.id === room.idHex)).toBe(false);
  });

  it('rehydrateNewRooms picks up rooms created by a sibling process', async () => {
    // Simulate two managers on the same identity + sqlite, like
    // `agentchat mcp` + `agentchat web` running simultaneously. Process A
    // creates a room; process B should see it after rehydrateNewRooms().
    const alice = makeIdentity();
    const { repo, dir, close } = tmpDb();

    const mgrA = new RoomManager({
      identity: alice,
      repo,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await mgrA.start();

    // Mgr B pointing at the same repo.
    const { openDatabase } = await import('../src/store/db.js');
    const { Repo } = await import('../src/store/repo.js');
    const dbB = openDatabase(`${dir}/store.db`);
    const repoB = new Repo(dbB);
    const mgrB = new RoomManager({
      identity: alice,
      repo: repoB,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await mgrB.start();

    // A creates a room AFTER B started — B has no in-memory record yet.
    const room = await mgrA.createRoom('#sibling');
    expect(mgrB.rooms.has(room.idHex)).toBe(false);

    // B rehydrates; now it sees the room.
    const added = await mgrB.rehydrateNewRooms();
    expect(added).toBe(1);
    expect(mgrB.rooms.has(room.idHex)).toBe(true);

    // Second call is a no-op.
    expect(await mgrB.rehydrateNewRooms()).toBe(0);

    dbB.close();
    close();
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
