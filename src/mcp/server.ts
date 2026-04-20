import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PROMPTS } from './prompts.js';
import type { ToolContext } from './tools.js';
import { ALL_TOOLS } from './tools.js';
import { zodToJsonSchema } from './zodToJsonSchema.js';

export interface BuildServerOptions {
  ctx: ToolContext;
  version: string;
}

export function buildServer(opts: BuildServerOptions): Server {
  const server = new Server(
    { name: 'agentchat', version: opts.version },
    { capabilities: { tools: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = ALL_TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    try {
      const parsed = tool.inputSchema.parse(req.params.arguments ?? {});
      const result = await tool.handler(opts.ctx, parsed);
      return {
        content: result.content,
        structuredContent: result.structuredContent,
        isError: result.isError,
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text', text: `Error: ${e.message || String(e)}` }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const prompt = PROMPTS.find((p) => p.name === req.params.name);
    if (!prompt) throw new Error(`Unknown prompt: ${req.params.name}`);
    const args = (req.params.arguments || {}) as Record<string, string>;
    return {
      description: prompt.description,
      messages: [prompt.render(args)],
    };
  });

  return server;
}
