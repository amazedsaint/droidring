import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blake3, concatBytes } from '../p2p/crypto.js';

export interface RepoRoom {
  /** Canonical identifier, e.g. "github.com/acme/foo". */
  canonical: string;
  /** Owner portion (before the slash). */
  owner: string;
  /** Repo portion (after the slash, no .git suffix). */
  repo: string;
  /** Room name humans see in the sidebar, e.g. "#acme/foo". */
  roomName: string;
  /** 32-byte deterministic seed derived from the canonical URL. */
  rootSecret: Uint8Array;
  /** All-zeros "creator" — no one has the private key, so no peer can sign
   * kick/close/members envelopes. The room is effectively leaderless:
   * members discover each other via mutual hellos; there's no key rotation. */
  leaderlessCreator: Uint8Array;
}

/**
 * Read ~/.git/config for the current working directory (or any override)
 * and return a RepoRoom if the origin remote looks like a GitHub repo.
 *
 * Supported remote URL shapes (same canonical mapping):
 *   git@github.com:acme/foo.git       → github.com/acme/foo
 *   https://github.com/acme/foo.git   → github.com/acme/foo
 *   https://github.com/acme/foo       → github.com/acme/foo
 *   ssh://git@github.com/acme/foo.git → github.com/acme/foo
 *
 * Non-GitHub remotes, detached checkouts, and repos without an `origin`
 * remote all return null — auto-joining rooms from arbitrary URLs has
 * unclear privacy semantics across forges, so v1 is GitHub-only.
 */
export function detectRepoRoom(cwd = process.cwd()): RepoRoom | null {
  const remote = readOriginRemote(cwd);
  if (!remote) return null;
  const parsed = parseGithubRemote(remote);
  if (!parsed) return null;
  const canonical = `github.com/${parsed.owner}/${parsed.repo}`;
  const roomName = `#${parsed.owner}/${parsed.repo}`;
  const label = new TextEncoder().encode('droidring v1 repo-room');
  const rootSecret = blake3(concatBytes(label, new TextEncoder().encode(canonical)), 32);
  return {
    canonical,
    owner: parsed.owner,
    repo: parsed.repo,
    roomName,
    rootSecret,
    leaderlessCreator: new Uint8Array(32),
  };
}

function readOriginRemote(cwd: string): string | null {
  try {
    const cfg = readFileSync(join(cwd, '.git', 'config'), 'utf8');
    // Walk sections; when we hit [remote "origin"] capture the subsequent
    // `url = ...` value before the next [section].
    let inOrigin = false;
    for (const raw of cfg.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        inOrigin = /^\[remote "origin"\]/.test(line);
        continue;
      }
      if (!inOrigin) continue;
      const m = /^url\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  // git@github.com:owner/repo(.git)?
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  // ssh://git@github.com/owner/repo(.git)?
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (sshUrl) return { owner: sshUrl[1], repo: sshUrl[2] };
  // https://github.com/owner/repo(.git)?
  const https = /^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}
