import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse, createServer } from 'node:http';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface HttpOpts {
  host: string;
  port: number;
  build: () => Promise<McpServer>;
}

/**
 * Minimal Streamable HTTP transport wrapper.
 * One session per client; the transport itself handles POST + SSE upgrade.
 */
export function startHttpMcp(opts: HttpOpts) {
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer }
  >();

  const srv = createServer(async (req, res) => {
    try {
      if (req.url !== '/mcp' && !req.url?.startsWith('/mcp?')) {
        res.writeHead(404).end('not found');
        return;
      }
      await handle(req, res);
    } catch (err: any) {
      try {
        res.writeHead(500, { 'content-type': 'text/plain' }).end(err.message || 'error');
      } catch {
        /* ignore */
      }
    }
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sid = (req.headers['mcp-session-id'] as string | undefined) || undefined;
    let session = sid ? sessions.get(sid) : undefined;

    if (!session) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      const server = await opts.build();
      await server.connect(transport);
      session = { transport, server };
    }

    await session.transport.handleRequest(req, res);
  }

  srv.listen(opts.port, opts.host);
  return srv;
}
