import { workerToolNames, type LaunchContext } from '../../types/index.ts';
import type { ToolPolicy } from './decision.ts';

/** The worker server of one attempt and the servers of the specialist, by exact name. */
export interface AttemptServers {
  worker: string;
  command: string;
  args: string[];
  tools: string[];
  own: { name: string; command: string; args: string[]; env: Record<string, string> }[];
}

/** A unique name per attempt: a server of the user or of an earlier attempt never takes it. */
export function attemptServers(context: LaunchContext): AttemptServers {
  const worker = `aip-${context.sessionId}`;
  const [command = '', ...args] = context.workerCommand;
  return {
    worker,
    command,
    args,
    tools: workerToolNames({
      split: args.includes('--split'),
      queue: args.includes('--queue'),
      repair: args.includes('--repair'),
    }),
    own: Object.entries(context.specialist.mcp ?? {}).map(([name, server]) => ({
      name: `${worker}-${name}`,
      command: server.command,
      args: server.args,
      env: server.env,
    })),
  };
}

export function toolPolicy(context: LaunchContext, servers: AttemptServers): ToolPolicy {
  return {
    worktree: context.worktree,
    permissions: context.specialist.permissions,
    allowCommands: context.specialist.allowCommands,
    server: servers.worker,
    tools: servers.tools,
    servers: servers.own.map((server) => server.name),
    readDirectories: context.attachmentsDirectory ? [context.attachmentsDirectory] : [],
  };
}

/** The prompt line that names the server of this attempt. */
export function serverNote(servers: AttemptServers): string {
  return `Use only the current MCP server \`${servers.worker}\` for aip tools, including swarm_report. Do not use a worker from an earlier attempt.`;
}

/** The private folder of the conversation; a CLI without one must not start. */
export function conversationOf(context: LaunchContext, runtime: string): string {
  if (!context.conversationDirectory) {
    throw new Error(`${runtime}: the attempt has no private conversation state`);
  }
  return context.conversationDirectory;
}
