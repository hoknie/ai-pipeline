import { z } from 'zod';
import { decideToolCall, toolPolicySchema, type ToolCall } from '../policy/index.ts';

const requestSchema = z.looseObject({
  preToolUse: z.looseObject({
    toolName: z.string(),
    parameters: z.record(z.string(), z.unknown()).default({}),
  }),
});

const READ_TOOLS = new Set([
  'read_file',
  'list_files',
  'search_files',
  'list_code_definition_names',
]);
const WRITE_TOOLS = new Set(['write_to_file', 'replace_in_file', 'apply_patch']);
/** Ends a task without touching anything. */
const HARMLESS = new Set(['attempt_completion']);

/** The refusal in the format of the hook of the CLI. */
export const CLINE_REFUSAL = {
  cancel: true,
  errorMessage: 'aip: invalid permission request or policy',
};

function callOf(name: string, parameters: Record<string, unknown>): ToolCall {
  if (name === 'execute_command') {
    return { kind: 'shell', command: parameters.command, cwd: parameters.cwd };
  }
  if (READ_TOOLS.has(name)) return { kind: 'read', path: parameters.path };
  if (WRITE_TOOLS.has(name)) return { kind: 'write', path: parameters.path };
  if (name === 'use_mcp_tool') {
    return { kind: 'mcp', server: parameters.server_name, tool: parameters.tool_name };
  }
  // resources of a server are a read of its content: only the servers of the specialist
  if (name === 'access_mcp_resource') {
    return { kind: 'mcp', server: parameters.server_name, tool: '' };
  }
  return { kind: 'other', name };
}

/**
 * The generated PreToolUse hook calls this boundary. Everything the CLI could do that is not a
 * listed tool is refused, and so is a malformed policy or request.
 */
export function decide(
  policy: unknown,
  request: unknown,
): { cancel: boolean; errorMessage?: string } {
  const checked = toolPolicySchema.safeParse(policy);
  const parsed = requestSchema.safeParse(request);
  if (!checked.success || !parsed.success) return CLINE_REFUSAL;
  const { toolName, parameters } = parsed.data.preToolUse;
  if (HARMLESS.has(toolName)) return { cancel: false };
  const decision = decideToolCall(checked.data, callOf(toolName, parameters));
  return decision.allow ? { cancel: false } : { cancel: true, errorMessage: decision.reason };
}
