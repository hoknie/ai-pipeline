import { z } from 'zod';
import {
  decideToolCall,
  toolPolicySchema,
  type ToolCall,
  type ToolPolicy,
} from '../policy/index.ts';

const requestSchema = z.looseObject({
  cwd: z.string().optional(),
  toolName: z.string(),
  /** The arguments arrive as a JSON string. */
  toolArgs: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

/** The refusal in the format of the pre-tool hook of the CLI. */
export const COPILOT_REFUSAL = {
  permissionDecision: 'deny',
  permissionDecisionReason: 'aip: invalid permission request or policy',
};

const SHELL = new Set(['bash', 'shell', 'powershell']);
const READ = new Set(['view', 'read', 'glob', 'grep', 'list_dir', 'search']);
const WRITE = new Set(['edit', 'create', 'write', 'str_replace', 'apply_patch']);
const HARMLESS = new Set(['report_intent', 'task_complete', 'update_todo']);

function argumentsOf(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined) return {};
  if (typeof raw !== 'string') return raw as Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `<server><separator><tool>`: the longest known server name wins, so a longer name is not a prefix match. */
function mcpCall(policy: ToolPolicy, name: string): ToolCall | null {
  const servers = [policy.server, ...policy.servers].sort((a, b) => b.length - a.length);
  for (const server of servers) {
    for (const separator of ['__', '-', '/', '_']) {
      if (name.startsWith(`${server}${separator}`)) {
        return { kind: 'mcp', server, tool: name.slice(server.length + separator.length) };
      }
    }
  }
  return null;
}

/**
 * The generated pre-tool hook calls this boundary: shell, file and MCP actions are decided from the
 * whole command, the canonical path and the exact server. Anything unknown, any malformed policy or
 * request, is refused.
 */
export function decide(
  policy: unknown,
  request: unknown,
): { permissionDecision: 'allow' | 'deny'; permissionDecisionReason: string } {
  const checked = toolPolicySchema.safeParse(policy);
  const parsed = requestSchema.safeParse(request);
  if (!checked.success || !parsed.success) return COPILOT_REFUSAL as never;
  const { toolName, cwd } = parsed.data;
  const args = argumentsOf(parsed.data.toolArgs);
  if (args === null) return COPILOT_REFUSAL as never;
  if (HARMLESS.has(toolName)) {
    return { permissionDecision: 'allow', permissionDecisionReason: 'aip: harmless' };
  }
  const base = checked.data.worktree;
  const path = args.path ?? args.filePath ?? args.file_path ?? cwd ?? base;
  let call: ToolCall;
  if (SHELL.has(toolName)) call = { kind: 'shell', command: args.command, cwd: cwd ?? base };
  else if (READ.has(toolName)) call = { kind: 'read', path };
  else if (WRITE.has(toolName)) call = { kind: 'write', path };
  else call = mcpCall(checked.data, toolName) ?? { kind: 'other', name: toolName };
  const decision = decideToolCall(checked.data, call);
  return {
    permissionDecision: decision.allow ? 'allow' : 'deny',
    permissionDecisionReason: decision.reason,
  };
}
