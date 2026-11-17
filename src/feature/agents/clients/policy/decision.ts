import { resolve } from 'node:path';
import { z } from 'zod';
import { allowedCommand } from '../agy/guard-commands.ts';
import { insideWorktree } from '../agy/guard-paths.ts';

/** What one attempt of a CLI may do; written next to the gate and read back by it. */
export const toolPolicySchema = z.object({
  worktree: z.string(),
  permissions: z.enum(['read', 'edit', 'full', 'none']),
  allowCommands: z.array(z.string()),
  /** The exact name of the worker server of this attempt. */
  server: z.string(),
  /** The tools of the worker the attempt may call. */
  tools: z.array(z.string()),
  /** The exact names of the servers of the specialist, for this attempt only. */
  servers: z.array(z.string()).default([]),
  /** Folders outside the worktree the specialist may read. */
  readDirectories: z.array(z.string()).default([]),
});
export type ToolPolicy = z.infer<typeof toolPolicySchema>;

/** An action of the agent, however the CLI names it. */
export type ToolCall =
  | { kind: 'shell'; command: unknown; cwd?: unknown }
  | { kind: 'write'; path: unknown }
  | { kind: 'read'; path: unknown }
  | { kind: 'mcp'; server: unknown; tool: unknown }
  | { kind: 'other'; name: string };

export interface ToolDecision {
  allow: boolean;
  reason: string;
}

const deny = (reason: string): ToolDecision => ({ allow: false, reason: `aip: ${reason}` });
const allow = (): ToolDecision => ({ allow: true, reason: 'aip: allowed by this attempt' });

/** A relative path means a path in the worktree; `..` and links are settled by the canonical check. */
function absolute(policy: ToolPolicy, path: unknown): unknown {
  return typeof path === 'string' && path !== '' ? resolve(policy.worktree, path) : path;
}

function mcpDecision(policy: ToolPolicy, call: { server: unknown; tool: unknown }): ToolDecision {
  const { server, tool } = call;
  if (typeof server !== 'string' || server === '') return deny('an MCP call without a server');
  // Exact names only: a server that merely starts with the name of ours is another server.
  if (server === policy.server) {
    return typeof tool === 'string' && policy.tools.includes(tool)
      ? allow()
      : deny(`the tool of the worker is not allowed`);
  }
  return policy.servers.includes(server) ? allow() : deny(`MCP server ${server} is not allowed`);
}

/** The decision for one action; an unknown action, a malformed one or no level is refused. */
export function decideToolCall(policy: ToolPolicy, call: ToolCall): ToolDecision {
  if (policy.permissions === 'none') return deny('no tool is allowed');
  const { permissions } = policy;
  switch (call.kind) {
    case 'mcp':
      return mcpDecision(policy, call);
    case 'read':
      return permissions === 'full' ||
        [policy.worktree, ...policy.readDirectories].some((root) =>
          insideWorktree(root, absolute(policy, call.path)),
        )
        ? allow()
        : deny('reading outside the worktree');
    case 'write':
      if (permissions === 'read') return deny('this attempt may not write');
      return insideWorktree(policy.worktree, absolute(policy, call.path))
        ? allow()
        : deny('writing outside the worktree');
    case 'shell':
      if (permissions === 'read') return deny('this attempt may not run commands');
      if (!insideWorktree(policy.worktree, absolute(policy, call.cwd ?? policy.worktree))) {
        return deny('a command outside the worktree');
      }
      return allowedCommand(call.command, permissions === 'full' ? null : policy.allowCommands)
        ? allow()
        : deny('the command is not allowed');
    case 'other':
      return deny(`${call.name} is outside this attempt's permissions`);
  }
}
