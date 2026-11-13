import { z } from 'zod';
import { insideWorktree } from './guard-paths.ts';
import { allowedCommand } from './guard-commands.ts';

const policySchema = z.object({
  worktree: z.string(),
  permissions: z.enum(['read', 'edit', 'full', 'none']),
  allowCommands: z.array(z.string()),
  server: z.string(),
  tools: z.array(z.string()),
  /** Names of the attempt of the MCP servers of the specialist; absent in older policies. */
  servers: z.array(z.string()).default([]),
});
export type AgyPolicy = z.infer<typeof policySchema>;
const hookSchema = z.object({
  toolCall: z.object({ name: z.string(), args: z.record(z.string(), z.unknown()) }),
});
const READ_TOOLS = new Set(['view_file', 'read_file', 'list_dir', 'find_by_name', 'grep_search']);
const WRITE_PATHS: Record<string, string> = {
  write_to_file: 'TargetFile',
  replace_file_content: 'TargetFile',
  multi_replace_file_content: 'TargetFile',
  write_file: 'Path',
  edit_file: 'Path',
};
const READ_PATHS: Record<string, string> = {
  view_file: 'AbsolutePath',
  read_file: 'Path',
  list_dir: 'DirectoryPath',
  find_by_name: 'SearchDirectory',
  grep_search: 'SearchPath',
};

/** The server a tool name `mcp_<server>_<tool>` belongs to: the longest name that fits. */
function ownerOf(policy: AgyPolicy, name: string): string | null {
  if (!name.startsWith('mcp_')) return null;
  const rest = name.slice(4);
  const owners = [policy.server, ...policy.servers].filter(
    (server) => server !== '' && rest.startsWith(`${server}_`),
  );
  return owners.sort((a, b) => b.length - a.length)[0] ?? null;
}

function mcpAllowed(policy: AgyPolicy, name: string, args: Record<string, unknown>): boolean {
  const worker = policy.server;
  const own = (server: unknown): boolean =>
    typeof server === 'string' && (server === worker || policy.servers.includes(server));
  if (name === 'list_resources' || name === 'read_resource') return own(args.ServerName);
  if (name === 'call_mcp_tool') {
    if (!own(args.ServerName)) return false;
    if (args.ServerName !== worker) return true;
    return typeof args.ToolName === 'string' && policy.tools.includes(args.ToolName);
  }
  const owner = ownerOf(policy, name);
  if (owner === null) return false;
  if (owner !== worker) return true;
  return policy.tools.includes(name.slice(`mcp_${worker}_`.length));
}

function permit(policy: AgyPolicy, name: string, args: Record<string, unknown>): boolean {
  if (policy.permissions === 'none') return false;
  if (mcpAllowed(policy, name, args)) return true;
  if (name === 'call_mcp_tool' || name.startsWith('mcp_')) return false;
  if (READ_TOOLS.has(name))
    return (
      policy.permissions === 'full' || insideWorktree(policy.worktree, args[READ_PATHS[name] ?? ''])
    );
  const writePath = WRITE_PATHS[name];
  if (writePath)
    return (
      policy.permissions !== 'read' &&
      (policy.permissions === 'full' || insideWorktree(policy.worktree, args[writePath]))
    );
  if (name === 'run_command')
    return (
      policy.permissions !== 'read' &&
      insideWorktree(policy.worktree, args.Cwd ?? policy.worktree) &&
      allowedCommand(args.CommandLine, policy.permissions === 'full' ? null : policy.allowCommands)
    );
  // Unchecked background input and delegated agents could bypass the command policy.
  if (
    ['manage_task', 'invoke_subagent', 'define_subagent', 'schedule', 'ask_permission'].includes(
      name,
    )
  )
    return false;
  return policy.permissions === 'full';
}

/** The generated hook calls this boundary; malformed policy or requests always return a denial. */
export function agyToolDecision(
  policy: unknown,
  request: unknown,
): { decision: 'deny' | 'auto_approve'; reason: string } {
  const checked = policySchema.safeParse(policy);
  const parsed = hookSchema.safeParse(request);
  if (!checked.success || !parsed.success)
    return { decision: 'deny', reason: 'aip: invalid permission request or policy' };
  const { name, args } = parsed.data.toolCall;
  const allowed = permit(checked.data, name, args);
  return {
    decision: allowed ? 'auto_approve' : 'deny',
    reason: allowed
      ? 'aip: allowed by this attempt'
      : `aip: ${name} is outside this attempt's permissions`,
  };
}
