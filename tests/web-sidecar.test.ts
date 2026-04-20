import { describe, expect, it } from 'vitest';
import { RoomManager } from '../src/p2p/manager.js';
import { Swarm } from '../src/p2p/swarm.js';
import { startWebServer } from '../src/web/server.js';
import { makeIdentity, tmpDb } from './helpers.js';

class FakeSwarm extends Swarm {
  override async start(): Promise<void> {}
  override async joinTopic(): Promise<void> {}
  override async leaveTopic(): Promise<void> {}
  override broadcast(): void {}
  override async destroy(): Promise<void> {}
}

describe('Web sidecar launch', () => {
  it('second process that finds the port taken does not crash', async () => {
    const id = makeIdentity();
    const { repo, close } = tmpDb();
    const manager = new RoomManager({
      identity: id,
      repo,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager.start();
    const first = await startWebServer({ host: '127.0.0.1', port: 0, manager, repo, token: 'tok' });
    const port = first.address.port;

    const id2 = makeIdentity();
    const { repo: repo2, close: close2 } = tmpDb();
    const manager2 = new RoomManager({
      identity: id2,
      repo: repo2,
      nickname: 'b',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager2.start();

    // Occupying the same port should surface as EADDRINUSE. We verify that
    // startWebServer itself rejects cleanly (the sidecar helper above swallows
    // this error in production).
    await expect(
      startWebServer({ host: '127.0.0.1', port, manager: manager2, repo: repo2, token: 'tok2' }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });

    await first.close();
    await manager.stop();
    await manager2.stop();
    close();
    close2();
  });
});
