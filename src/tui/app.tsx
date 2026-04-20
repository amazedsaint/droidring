import { Box, Text, render, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useEffect, useMemo, useState } from 'react';
import type { RoomManager } from '../p2p/manager.js';
import type { Repo } from '../store/repo.js';
import { createTuiClient } from './client.js';

interface DisplayMessage {
  id: string;
  room_id: string;
  nickname: string;
  sender: string;
  text: string;
  ts: string;
}

interface RoomDisplay {
  id: string;
  name: string;
  topic: string;
  members: number;
  unread: number;
}

function App({ manager, repo }: { manager: RoomManager; repo: Repo }) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [rooms, setRooms] = useState<RoomDisplay[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [status, setStatus] = useState('ready');

  const refreshRooms = () => {
    const list: RoomDisplay[] = [...manager.rooms.values()].map((r) => ({
      id: r.idHex,
      name: r.name,
      topic: r.topic,
      members: r.members.size,
      unread: 0,
    }));
    setRooms(list);
    if (!activeRoomId && list[0]) setActiveRoomId(list[0].id);
  };

  const refreshMessages = (roomId: string) => {
    const rows = repo.fetchMessages(roomId, 100);
    setMessages(rows.map((r) => ({ ...r, ts: r.ts })) as DisplayMessage[]);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshRooms is a stable closure over manager; re-subscribing on every render would thrash event listeners.
  useEffect(() => {
    refreshRooms();
    const onMessage = (row: any) => {
      if (row.room_id === activeRoomId) {
        setMessages((prev) => [...prev, { ...row }]);
      }
      refreshRooms();
    };
    manager.on('message', onMessage);
    manager.on('members_update', refreshRooms);
    return () => {
      manager.off('message', onMessage);
      manager.off('members_update', refreshRooms);
    };
  }, [manager, activeRoomId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshMessages reads from repo which is stable for this effect's lifetime.
  useEffect(() => {
    if (activeRoomId) refreshMessages(activeRoomId);
  }, [activeRoomId]);

  useInput((_char, key) => {
    if (key.ctrl && _char === 'n') {
      const idx = rooms.findIndex((r) => r.id === activeRoomId);
      const next = rooms[(idx + 1) % Math.max(rooms.length, 1)];
      if (next) setActiveRoomId(next.id);
    } else if (key.ctrl && _char === 'p') {
      const idx = rooms.findIndex((r) => r.id === activeRoomId);
      const prev = rooms[(idx - 1 + rooms.length) % Math.max(rooms.length, 1)];
      if (prev) setActiveRoomId(prev.id);
    } else if (key.ctrl && _char === 'c') {
      exit();
    }
  });

  const activeRoom = useMemo(() => rooms.find((r) => r.id === activeRoomId), [rooms, activeRoomId]);

  const onSubmit = async (line: string) => {
    setInput('');
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('/')) {
      await handleSlash(trimmed);
      return;
    }
    if (!activeRoomId) {
      setStatus('no active room');
      return;
    }
    const room = [...manager.rooms.values()].find((r) => r.idHex === activeRoomId);
    if (!room) return;
    room.sendMessage(trimmed);
  };

  async function handleSlash(cmd: string): Promise<void> {
    const [verb, ...rest] = cmd.slice(1).split(/\s+/);
    const argstr = rest.join(' ');
    try {
      if (verb === 'join') {
        const room = await manager.joinByTicket(argstr);
        setActiveRoomId(room.idHex);
        refreshRooms();
        setStatus(`joined ${room.name}`);
      } else if (verb === 'create') {
        const room = await manager.createRoom(rest[0] || 'untitled');
        setActiveRoomId(room.idHex);
        refreshRooms();
        setStatus(`created ${room.name}: ticket on stdout`);
        process.stderr.write(`ticket: ${room.toTicket()}\n`);
      } else if (verb === 'leave') {
        const target = rest[0] || activeRoom?.name;
        if (target) {
          await manager.leaveRoom(target);
          refreshRooms();
          setStatus(`left ${target}`);
        }
      } else if (verb === 'nick') {
        manager.setNickname(rest[0] || manager.getNickname());
        setStatus(`nickname = ${manager.getNickname()}`);
      } else if (verb === 'help') {
        setStatus('commands: /join /create /leave /nick /help /quit');
      } else if (verb === 'quit' || verb === 'exit') {
        exit();
      } else {
        setStatus(`unknown command: /${verb}`);
      }
    } catch (e: any) {
      setStatus(`err: ${e.message}`);
    }
  }

  return (
    <Box flexDirection="column" height={process.stdout.rows || 24}>
      <Box flexGrow={1}>
        <Box flexDirection="column" width={28} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text bold>Rooms</Text>
          {rooms.length === 0 ? <Text dimColor>no rooms (/create or /join)</Text> : null}
          {rooms.map((r) => (
            <Text key={r.id} color={r.id === activeRoomId ? 'cyan' : undefined}>
              {r.id === activeRoomId ? '▶ ' : '  '}
              {r.name}
              <Text dimColor> ({r.members})</Text>
            </Text>
          ))}
        </Box>
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold>{activeRoom ? `#${activeRoom.name}` : '(no room)'}</Text>
          {activeRoom?.topic ? <Text dimColor>topic: {activeRoom.topic}</Text> : null}
          <Box flexDirection="column" flexGrow={1}>
            {messages.slice(-30).map((m) => (
              <Text key={m.id}>
                <Text dimColor>[{m.ts.slice(11, 16)}]</Text>{' '}
                <Text color="green">@{m.nickname || m.sender.slice(0, 6)}</Text>: {m.text}
              </Text>
            ))}
          </Box>
        </Box>
      </Box>
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="yellow">›</Text>
        <Text> </Text>
        <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>^N next • ^P prev • ^C quit • {status}</Text>
      </Box>
    </Box>
  );
}

export async function startTui(opts: { daemonUrl?: string }): Promise<void> {
  const { manager, repo } = await createTuiClient(opts);
  render(<App manager={manager} repo={repo} />);
}
