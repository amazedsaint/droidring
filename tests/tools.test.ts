import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../src/mcp/tools.js';
import { zodToJsonSchema } from '../src/mcp/zodToJsonSchema.js';
import { randomKey } from '../src/p2p/crypto.js';
import { RoomManager } from '../src/p2p/manager.js';
import { Room } from '../src/p2p/room.js';
import { Swarm } from '../src/p2p/swarm.js';
import { InMemoryBroker, makeIdentity, tmpDb } from './helpers.js';

describe('MCP tool schemas', () => {
  it('every tool produces a valid JSON schema', () => {
    for (const t of ALL_TOOLS) {
      const schema = zodToJsonSchema(t.inputSchema);
      expect(schema.type).toBe('object');
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});

// Build a manager that never touches the DHT: substitute a fake Swarm.
class FakeSwarm extends Swarm {
  override async start(): Promise<void> {}
  override async joinTopic(): Promise<void> {}
  override async leaveTopic(): Promise<void> {}
  override broadcast(): void {}
  override async destroy(): Promise<void> {}
}

describe('MCP tool handlers', () => {
  it('whoami returns pubkey and nickname', async () => {
    const id = makeIdentity();
    const { repo } = tmpDb();
    const manager = new RoomManager({
      identity: id,
      repo,
      nickname: 'alice',
      clientName: 'test',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager.start();
    const tool = ALL_TOOLS.find((t) => t.name === 'chat_whoami')!;
    const res = await tool.handler({ manager, repo }, {});
    expect(res.structuredContent.nickname).toBe('alice');
    expect(res.structuredContent.pubkey.length).toBe(64);
  });

  it('create_room returns a ticket and list_rooms shows it', async () => {
    const id = makeIdentity();
    const { repo } = tmpDb();
    const manager = new RoomManager({
      identity: id,
      repo,
      nickname: 'alice',
      clientName: 'test',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager.start();
    const create = ALL_TOOLS.find((t) => t.name === 'chat_create_room')!;
    const r = await create.handler({ manager, repo }, { name: '#a' });
    expect(r.structuredContent.ticket.length).toBeGreaterThan(20);

    const list = ALL_TOOLS.find((t) => t.name === 'chat_list_rooms')!;
    const l = await list.handler({ manager, repo }, {});
    expect(l.structuredContent.rooms.length).toBe(1);
    expect(l.structuredContent.rooms[0].name).toBe('#a');
  });

  it('send_message + fetch_history roundtrip locally', async () => {
    const id = makeIdentity();
    const { repo } = tmpDb();
    const manager = new RoomManager({
      identity: id,
      repo,
      nickname: 'alice',
      clientName: 'test',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager.start();
    const create = ALL_TOOLS.find((t) => t.name === 'chat_create_room')!;
    await create.handler({ manager, repo }, { name: '#g' });
    const send = ALL_TOOLS.find((t) => t.name === 'chat_send_message')!;
    await send.handler({ manager, repo }, { room: '#g', text: 'hi' });
    const hist = ALL_TOOLS.find((t) => t.name === 'chat_fetch_history')!;
    const res = await hist.handler({ manager, repo }, { room: '#g', limit: 10 });
    expect(res.structuredContent.messages.length).toBe(1);
    expect(res.structuredContent.messages[0].text).toBe('hi');
  });

  it('kick with malformed pubkey returns error instead of throwing', async () => {
    const id = makeIdentity();
    const { repo } = tmpDb();
    const manager = new RoomManager({
      identity: id,
      repo,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager.start();
    const create = ALL_TOOLS.find((t) => t.name === 'chat_create_room')!;
    await create.handler({ manager, repo }, { name: '#k' });
    const kick = ALL_TOOLS.find((t) => t.name === 'chat_kick')!;
    const res = await kick.handler(
      { manager, repo },
      { room: '#k', pubkey: 'not-valid-base32-or-hex-@!' },
    );
    expect(res.isError).toBe(true);
  });

  it('direct_message with unknown peer returns error', async () => {
    const id = makeIdentity();
    const { repo } = tmpDb();
    const manager = new RoomManager({
      identity: id,
      repo,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager.start();
    const dm = ALL_TOOLS.find((t) => t.name === 'chat_direct_message')!;
    const res = await dm.handler({ manager, repo }, { peer: 'nobody', text: 'hi' });
    expect(res.isError).toBe(true);
  });

  it('join_room with invalid ticket returns error', async () => {
    const id = makeIdentity();
    const { repo } = tmpDb();
    const manager = new RoomManager({
      identity: id,
      repo,
      nickname: 'a',
      clientName: 't',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager.start();
    const join = ALL_TOOLS.find((t) => t.name === 'chat_join_room')!;
    const res = await join.handler({ manager, repo }, { ticket: 'aaaaaaaaaaaaaaaaaaaa' });
    expect(res.isError).toBe(true);
  });

  it('send_message rejects oversized text at the zod layer', async () => {
    const id = makeIdentity();
    const { repo } = tmpDb();
    const manager = new RoomManager({
      identity: id,
      repo,
      nickname: 'a',
      clientName: 'test',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager.start();
    const create = ALL_TOOLS.find((t) => t.name === 'chat_create_room')!;
    await create.handler({ manager, repo }, { name: '#cap' });
    const send = ALL_TOOLS.find((t) => t.name === 'chat_send_message')!;
    const oversized = 'x'.repeat(16 * 1024 + 1);
    await expect(
      send.inputSchema.parseAsync({ room: '#cap', text: oversized }),
    ).rejects.toBeDefined();
  });

  it('returns error for unknown room', async () => {
    const id = makeIdentity();
    const { repo } = tmpDb();
    const manager = new RoomManager({
      identity: id,
      repo,
      nickname: 'a',
      clientName: 'test',
      version: '0',
      swarm: new FakeSwarm(),
    });
    await manager.start();
    const send = ALL_TOOLS.find((t) => t.name === 'chat_send_message')!;
    const res = await send.handler({ manager, repo }, { room: 'nope', text: 'x' });
    expect(res.isError).toBe(true);
  });
});
