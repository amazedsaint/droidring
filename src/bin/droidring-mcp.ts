import { runStdioServer } from './mcp-runner.js';

// Claude Code (and other MCP clients) launch this binary on stdio. By default
// we also boot the web UI alongside so the user can see chat / notes / graph
// in a browser while they code. Opt out with DROIDRING_WEB=0.
const webEnv = process.env.DROIDRING_WEB;
const web = !(webEnv === '0' || webEnv?.toLowerCase() === 'false');

runStdioServer({ web }).catch((err) => {
  console.error('[droidring-mcp] fatal:', err);
  process.exit(1);
});
