import type { Command } from 'commander';

import type { Style } from '../../format/index.ts';
import { request } from '../../ipc/client/index.ts';
import type { Method } from '../../ipc/contract/index.ts';
import { bind, call } from '../context.ts';
import { usage, type CliIo } from '../io.ts';

interface McpOptions {
  worker?: string;
  socket?: string;
  split?: boolean;
  queue?: boolean;
  repair?: boolean;
}

async function runMcp(options: McpOptions, io: CliIo, style: Style): Promise<void> {
  // Imported on demand: every attempt of a specialist starts a worker server.
  const [{ createHostServer, createWorkerServer }, { StdioServerTransport }] = await Promise.all([
    import('../../mcp/index.ts'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
  ]);
  if (options.worker) {
    const socket = options.socket;
    if (!socket) throw usage('--worker needs --socket');
    const server = createWorkerServer({
      token: options.worker,
      split: options.split ?? false,
      queue: options.queue ?? false,
      repair: options.repair ?? false,
      send: (method, params) => request(socket, method as Method, params as never),
    });
    await server.connect(new StdioServerTransport());
    return;
  }
  const ctx = bind(io, style).context();
  const server = createHostServer({
    cwd: io.cwd,
    send: (method, params) => call(ctx, method as Method, params as never),
  });
  await server.connect(new StdioServerTransport());
}

export function registerMcp(program: Command, io: CliIo, style: Style): void {
  const { examples } = bind(io, style);
  program
    .command('mcp')
    .description('Run the MCP server for Claude Code or OpenCode over stdio')
    .option('--worker <token>', 'serve swarm_report for one attempt (started by the daemon)')
    .option('--socket <path>', 'daemon socket (worker mode)')
    .option('--split', 'also serve swarm_split (split step)')
    .option('--queue', 'also serve swarm_queue_add (specialist with queue: true)')
    .option('--repair', 'also serve swarm_repair_* (observer of an incident)')
    .addHelpText('after', examples(['aip mcp', 'aip mcp --queue']))
    .action((options: McpOptions) => runMcp(options, io, style));
}
