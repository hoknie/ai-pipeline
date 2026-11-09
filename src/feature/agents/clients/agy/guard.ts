import { z } from 'zod';
import { insideWorktree } from './guard-paths.ts';
import { allowedCommand } from './guard-commands.ts';

const policySchema = z.object({
  worktree: z.string(),
  permissions: z.enum(['read', 'edit', 'full', 'none']),
  allowCommands: z.array(z.string()),
  server: z.string(),
  tools: z.array(z.string()),
});
export type AgyPolicy = z.infer<typeof policySchema>;
const hookSchema = z.object({
  toolCall: z.object({ name: z.string(), args: z.record(z.string(), z.unknown()) }),
});
const READ_TOOLS = new Set(['view_file', 'read_file', 'list_dir', 'find_by_name', 'grep_search']);
const WRITE_TOOLS = new Set([
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
]);
const READ_PATHS: Record<string, string> = {
  view_file: 'AbsolutePath',
  read_file: 'Path',
  list_dir: 'DirectoryPath',
  find_by_name: 'SearchDirectory',
  grep_search: 'SearchPath',
};

function mcpAllowed(policy: AgyPolicy, name: string, args: Record<string, unknown>): boolean {
  if (!policy.server) return false;
  if (name === 'list_resources' || name === 'read_resource')
    return args.ServerName === policy.server;
  if (name === 'call_mcp_tool')
    return (
      args.ServerName === policy.server &&
      typeof args.ToolName === 'string' &&
      policy.tools.includes(args.ToolName)
    );
  return policy.tools.some((tool) => name === `mcp_${policy.server}_${tool}`);
}

function permit(policy: AgyPolicy, name: string, args: Record<string, unknown>): boolean {
  if (policy.permissions === 'none') return false;
  if (mcpAllowed(policy, name, args)) return true;
  if (name === 'call_mcp_tool' || name.startsWith('mcp_')) return false;
  if (READ_TOOLS.has(name))
    return (
      policy.permissions === 'full' || insideWorktree(policy.worktree, args[READ_PATHS[name] ?? ''])
    );
  if (WRITE_TOOLS.has(name))
    return (
      policy.permissions !== 'read' &&
      (policy.permissions === 'full' || insideWorktree(policy.worktree, args.TargetFile))
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
