/**
 * Deterministic-repo-room tests.
 *
 * Two peers who both run `droingring` in the same git repo must land in the
 * SAME room without exchanging a ticket. That's the whole point of the
 * repo-room feature: derive a room id from the canonical GitHub URL so
 * coordination is automatic.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectRepoRoom, parseGithubRemote } from '../src/bin/repo-detect.js';
import type { Envelope } from '../src/p2p/envelope.js';
import { RoomManager } from '../src/p2p/manager.js';
import { Swarm } from '../src/p2p/swarm.js';
import { makeIdentity, tmpDb } from './helpers.js';

describe('parseGithubRemote', () => {
  it.each([
    ['git@github.com:acme/foo.git', 'acme', 'foo'],
    ['git@github.com:acme/foo', 'acme', 'foo'],
    ['https://github.com/acme/foo.git', 'acme', 'foo'],
    ['https://github.com/acme/foo', 'acme', 'foo'],
    ['https://github.com/acme/foo/', 'acme', 'foo'],
    ['ssh://git@github.com/acme/foo.git', 'acme', 'foo'],
    ['https://user:token@github.com/acme/foo.git', 'acme', 'foo'],
  ])('%s → %s/%s', (url, owner, repo) => {
    expect(parseGithubRemote(url)).toEqual({ owner, repo });
  });

  it('rejects non-GitHub remotes', () => {
    expect(parseGithubRemote('git@gitlab.com:acme/foo.git')).toBeNull();
    expect(parseGithubRemote('https://bitbucket.org/acme/foo')).toBeNull();
    expect(parseGithubRemote('not a url at all')).toBeNull();
  });
});

describe('detectRepoRoom', () => {
  it('returns null when cwd is not a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'droingring-norepo-'));
    try {
      expect(detectRepoRoom(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when git repo has no origin remote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'droingring-norem-'));
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
    try {
      expect(detectRepoRoom(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when origin is non-GitHub', () => {
    const dir = mkdtempSync(join(tmpdir(), 'droingring-gitlab-'));
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(
      join(dir, '.git', 'config'),
      '[remote "origin"]\n\turl = git@gitlab.com:acme/foo.git\n',
    );
    try {
      expect(detectRepoRoom(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('derives a stable room from a github remote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'droingring-gh-'));
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(
      join(dir, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/acme/bar.git\n',
    );
    try {
      const hit = detectRepoRoom(dir);
      expect(hit).not.toBeNull();
      expect(hit?.owner).toBe('acme');
      expect(hit?.repo).toBe('bar');
      expect(hit?.roomName).toBe('#acme/bar');
      expect(hit?.canonical).toBe('github.com/acme/bar');
      expect(hit?.rootSecret.length).toBe(32);
      expect(hit?.leaderlessCreator.every((b) => b === 0)).toBe(true);

      // Same URL → same rootSecret byte-for-byte.
      const hit2 = detectRepoRoom(dir);
      expect(Buffer.from(hit!.rootSecret).equals(Buffer.from(hit2!.rootSecret))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ssh and https URLs for the same repo produce the same rootSecret', () => {
    const dirSsh = mkdtempSync(join(tmpdir(), 'droingring-ssh-'));
    const dirHttps = mkdtempSync(join(tmpdir(), 'droingring-https-'));
    for (const [d, url] of [
      [dirSsh, 'git@github.com:acme/bar.git'],
      [dirHttps, 'https://github.com/acme/bar.git'],
    ] as const) {
      mkdirSync(join(d, '.git'), { recursive: true });
      writeFileSync(join(d, '.git', 'config'), `[remote "origin"]\n\turl = ${url}\n`);
    }
    try {
      const a = detectRepoRoom(dirSsh);
      const b = detectRepoRoom(dirHttps);
      expect(Buffer.from(a!.rootSecret).equals(Buffer.from(b!.rootSecret))).toBe(true);
    } finally {
      rmSync(dirSsh, { recursive: true, force: true });
      rmSync(dirHttps, { recursive: true, force: true });
    }
  });
});

// Shared in-memory swarm net — same pattern as tests/e2e-multi-agent.test.ts
class SwarmNet {
  private byTopic = new Map<string, Set<TestSwarm>>();
  join(sw: TestSwarm, topic: Uint8Array): void {
    const k = Buffer.from(topic).toString('hex');
    let set = this.byTopic.get(k);
    if (!set) {
      set = new Set();
      this.byTopic.set(k, set);
    }
    set.add(sw);
    for (const other of set) {
      if (other !== sw) {
        other.emit('connection');
        sw.emit('connection');
      }
    }
  }
  leave(sw: TestSwarm, topic: Uint8Array): void {
    const k = Buffer.from(topic).toString('hex');
    this.byTopic.get(k)?.delete(sw);
  }
  deliver(origin: TestSwarm, env: Envelope): void {
    const k = Buffer.from(env.room).toString('hex');
    const set = this.byTopic.get(k);
    if (!set) return;
    for (const sw of set) {
      if (sw !== origin) setImmediate(() => sw.emit('envelope', env));
    }
  }
}
class TestSwarm extends Swarm {
  constructor(private readonly net: SwarmNet) {
    super();
  }
  override async start(): Promise<void> {}
  override async joinTopic(topic: Uint8Array): Promise<void> {
    this.net.join(this, topic);
  }
  override async leaveTopic(topic: Uint8Array): Promise<void> {
    this.net.leave(this, topic);
  }
  override broadcast(env: Envelope): void {
    this.net.deliver(this, env);
  }
  override async destroy(): Promise<void> {}
}

describe('Leaderless repo room', () => {
  it('two peers with the same repo URL converge without a ticket', async () => {
    const net = new SwarmNet();
    const hit = detectRepoRoomFromUrl('https://github.com/acme/bar.git');

    const alice = makeIdentity();
    const bob = makeIdentity();
    const a = tmpDb();
    const b = tmpDb();

    const aMgr = new RoomManager({
      identity: alice,
      repo: a.repo,
      nickname: 'alice',
      clientName: 'test',
      version: '0',
      swarm: new TestSwarm(net),
    });
    const bMgr = new RoomManager({
      identity: bob,
      repo: b.repo,
      nickname: 'bob',
      clientName: 'test',
      version: '0',
      swarm: new TestSwarm(net),
    });
    try {
      await aMgr.start();
      await bMgr.start();

      const aRoom = await aMgr.joinOrCreateLeaderlessRoom(
        hit.roomName,
        hit.rootSecret,
        hit.leaderlessCreator,
      );
      const bRoom = await bMgr.joinOrCreateLeaderlessRoom(
        hit.roomName,
        hit.rootSecret,
        hit.leaderlessCreator,
      );
      expect(aRoom.idHex).toBe(bRoom.idHex);

      await new Promise((r) => setTimeout(r, 80));
      // Both should know about each other via mutual hellos.
      expect(aRoom.members.size).toBe(2);
      expect(bRoom.members.size).toBe(2);

      // Messages still flow — epoch 0 key is derivable from the shared seed.
      aRoom.sendMessage('hello repo-mates');
      await new Promise((r) => setTimeout(r, 40));
      const bMsgs = b.repo.fetchMessages(bRoom.idHex, 20).map((m) => m.text);
      expect(bMsgs).toContain('hello repo-mates');
    } finally {
      await aMgr.stop();
      await bMgr.stop();
      a.close();
      b.close();
    }
  });

  it('idempotent re-join: second call returns the same Room instance', async () => {
    const net = new SwarmNet();
    const hit = detectRepoRoomFromUrl('https://github.com/acme/bar.git');
    const alice = makeIdentity();
    const a = tmpDb();
    const mgr = new RoomManager({
      identity: alice,
      repo: a.repo,
      nickname: 'alice',
      clientName: 'test',
      version: '0',
      swarm: new TestSwarm(net),
    });
    try {
      await mgr.start();
      const r1 = await mgr.joinOrCreateLeaderlessRoom(
        hit.roomName,
        hit.rootSecret,
        hit.leaderlessCreator,
      );
      const r2 = await mgr.joinOrCreateLeaderlessRoom(
        hit.roomName,
        hit.rootSecret,
        hit.leaderlessCreator,
      );
      expect(r1).toBe(r2);
    } finally {
      await mgr.stop();
      a.close();
    }
  });
});

// Helper: build a RepoRoom by setting up a tmp git config and running the
// real detector. Ensures we're exercising the same rootSecret derivation
// that the runtime would.
function detectRepoRoomFromUrl(url: string) {
  const dir = mkdtempSync(join(tmpdir(), 'droingring-gh-from-url-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'config'), `[remote "origin"]\n\turl = ${url}\n`);
  const hit = detectRepoRoom(dir);
  rmSync(dir, { recursive: true, force: true });
  if (!hit) throw new Error('detector returned null');
  return hit;
}
