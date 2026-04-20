import { buildContextAndServer } from '../bin/mcp-runner.js';
import type { RoomManager } from '../p2p/manager.js';
import type { Repo } from '../store/repo.js';

/**
 * The TUI talks to the daemon's HTTP MCP when available, otherwise runs in-process.
 * For v0.1 we just run in-process — plenty for a single-user terminal.
 */
export async function createTuiClient(_opts: { daemonUrl?: string }): Promise<{
  manager: RoomManager;
  repo: Repo;
}> {
  const { manager, repo } = await buildContextAndServer();
  return { manager, repo };
}
