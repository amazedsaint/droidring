import { spawn } from 'node:child_process';

/**
 * Open a URL in the user's default browser. Best-effort — silent on failure
 * (no browser installed, headless machine, sandbox restrictions, etc).
 * The child is detached + unref'd so it doesn't block our exit.
 */
export function tryOpenBrowser(url: string): void {
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    // "start" is a cmd.exe builtin; the empty "" is a required title placeholder.
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      // swallow — missing xdg-open / headless env is common and non-fatal.
    });
    child.unref();
  } catch {
    // swallow — spawn can throw synchronously on invalid args or ENOENT
    // depending on runtime; we never want a missing browser to crash the MCP.
  }
}
