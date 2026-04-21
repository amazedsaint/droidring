import { describe, expect, it } from 'vitest';
import { tmpDb } from './helpers.js';

describe('Repo LWW clock clamp', () => {
  it('clamps far-future note updated_at to now + 5 minutes', () => {
    const { repo, close } = tmpDb();
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000; // +1 year
    repo.applyNotePut({
      room_id: 'r',
      id: 'n1',
      author: 'evil',
      title: 'hostile',
      body: 'x',
      tags: [],
      updated_at: farFuture,
    });
    // A good-faith "now" write should be able to overwrite — the stored
    // timestamp must NOT be the far-future value.
    const nowIsh = Date.now();
    const changed = repo.applyNotePut({
      room_id: 'r',
      id: 'n1',
      author: 'honest',
      title: 'corrected',
      body: 'y',
      tags: [],
      updated_at: nowIsh + 10 * 60 * 1000, // 10 minutes ahead of "now"
    });
    expect(changed).toBe(true);
    const got = repo.getNote('r', 'n1');
    expect(got?.title).toBe('corrected');
    close();
  });

  it('clamps far-future graph updated_at to now + 5 minutes', () => {
    const { repo, close } = tmpDb();
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
    repo.applyGraphAssert({
      room_id: 'r',
      id: 'e1',
      src: 'a',
      predicate: 'p',
      dst: 'b',
      src_type: '',
      dst_type: '',
      src_label: '',
      dst_label: '',
      props: {},
      author: 'evil',
      updated_at: farFuture,
    });
    const changed = repo.applyGraphAssert({
      room_id: 'r',
      id: 'e1',
      src: 'a',
      predicate: 'p',
      dst: 'b2',
      src_type: '',
      dst_type: '',
      src_label: '',
      dst_label: '',
      props: {},
      author: 'honest',
      updated_at: Date.now() + 10 * 60 * 1000,
    });
    expect(changed).toBe(true);
    const edges = repo.queryGraph('r', {});
    expect(edges[0].dst).toBe('b2');
    close();
  });
});

describe('Repo fetchSince cap', () => {
  it('returns at most `limit` rows when since is undefined', () => {
    const { repo, close } = tmpDb();
    const base = Date.now();
    for (let i = 0; i < 1200; i++) {
      repo.insertMessage({
        id: `msg-${i}`,
        room_id: 'r',
        sender: 's',
        nickname: 'n',
        text: String(i),
        ts: new Date(base + i).toISOString(),
        reply_to: null,
        signature: 'sig',
      });
    }
    const rows = repo.fetchSince('r', undefined, 500);
    expect(rows.length).toBe(500);
    // Returned in ascending time order — the 500 most-recent rows.
    expect(rows[0].text).toBe('700');
    expect(rows[499].text).toBe('1199');
    close();
  });

  it('caps the since-based query too', () => {
    const { repo, close } = tmpDb();
    const base = Date.now();
    for (let i = 0; i < 1200; i++) {
      repo.insertMessage({
        id: `msg-${i}`,
        room_id: 'r',
        sender: 's',
        nickname: 'n',
        text: String(i),
        ts: new Date(base + i).toISOString(),
        reply_to: null,
        signature: 'sig',
      });
    }
    const rows = repo.fetchSince('r', new Date(base - 1).toISOString(), 500);
    expect(rows.length).toBe(500);
    close();
  });
});

describe('Repo sessions', () => {
  it('upsert / list / remove + GC of stale rows', () => {
    const { repo, close } = tmpDb();
    const now = Date.now();
    repo.upsertSession({
      id: 's1',
      pid: 111,
      client: 'claude-code',
      kind: 'agent',
      started_at: now,
      last_seen: now,
    });
    repo.upsertSession({
      id: 's2',
      pid: 222,
      client: 'tui',
      kind: 'human',
      started_at: now - 10_000,
      last_seen: now - 500_000, // stale
    });
    // listActiveSessions purges rows older than cutoff and returns the rest.
    const active = repo.listActiveSessions(now - 90_000);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('s1');

    // touch keeps alive, remove deletes.
    repo.touchSession('s1', now + 1_000);
    expect(repo.listActiveSessions(now).length).toBe(1);
    repo.removeSession('s1');
    expect(repo.listActiveSessions(now).length).toBe(0);
    close();
  });
});

describe('Repo markRoomClosed', () => {
  it('cascades delete of pending join requests', () => {
    const { repo, close } = tmpDb();
    repo.upsertRoom({
      id: 'room1',
      name: '#r',
      topic: '',
      creator_pubkey: 'c',
      root_secret: 'rs',
      epoch: 0,
      current_key: 'k',
      joined_at: new Date().toISOString(),
      left_at: null,
      admission_mode: 'approval',
      closed_at: null,
    });
    repo.upsertJoinRequest({
      room_id: 'room1',
      pubkey: 'pendingA',
      x25519_pub: 'xa',
      nickname: 'A',
      client: 't',
      ts: Date.now(),
    });
    repo.upsertJoinRequest({
      room_id: 'room1',
      pubkey: 'pendingB',
      x25519_pub: 'xb',
      nickname: 'B',
      client: 't',
      ts: Date.now(),
    });
    expect(repo.listJoinRequests('room1').length).toBe(2);

    repo.markRoomClosed('room1', Date.now());
    expect(repo.listJoinRequests('room1').length).toBe(0);
    close();
  });
});
