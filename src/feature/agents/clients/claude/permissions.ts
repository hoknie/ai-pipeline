import { OBSERVER_SPECIALIST } from '../../../swarm-config/types/index.ts';
import { workerToolNames, type LaunchContext } from '../../types/index.ts';

/** Setting sources without the user's level: no personal hooks, plugins or permission rules. */
export const PROJECT_SETTINGS = ['--setting-sources', 'project,local'];
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

/**
 * The aip tools the specialist may call without asking: the report, the artifact and the split
 * (the worker server offers the split only on the split step), and the queue when allowed.
 */
function aipTools(context: LaunchContext): string[] {
  return workerToolNames({
    split: true,
    queue: context.specialist.queue === true,
    repair: context.specialist.slug === OBSERVER_SPECIALIST,
  }).map((name) => `mcp__aip__${name}`);
}

/** Tools allowed without a prompt: those of aip and all of the specialist's own MCP servers. */
function mcpTools(context: LaunchContext): string[] {
  const own = Object.keys(context.specialist.mcp ?? {}).map((name) => `mcp__${name}`);
  return [...aipTools(context), ...own];
}

/** The specialist's own MCP servers as entries of the MCP configuration. */
export function ownMcpServers(context: LaunchContext): Record<string, object> {
  return Object.fromEntries(
    Object.entries(context.specialist.mcp ?? {}).map(([name, server]) => [
      name,
      { type: 'stdio', ...server },
    ]),
  );
}

/**
 * Built-in tools a specialist gets: the set of its permissions, Skill when it has skills, and
 * the tools of its configuration. Every other tool stays out of the context of each turn.
 */
export function claudeTools(context: LaunchContext): string[] {
  const { permissions, skills, tools } = context.specialist;
  const base = permissions === 'read' ? READ_TOOLS : [...READ_TOOLS, ...EDIT_TOOLS, 'Bash'];
  return [...new Set([...base, ...(skills.length > 0 ? ['Skill'] : []), ...tools])];
}

/** The rule that lets the specialist read the attachments folder; `//` marks an absolute path. */
export function attachmentReadRules(context: LaunchContext): string[] {
  return !context.attachmentsDirectory ? [] : [`Read(/${context.attachmentsDirectory}/**)`];
}

export function claudeAllowedTools(context: LaunchContext): string[] {
  const { permissions, allowCommands } = context.specialist;
  if (permissions === 'read')
    return [...READ_TOOLS, ...attachmentReadRules(context), ...mcpTools(context)];
  if (permissions === 'edit') {
    return [
      ...READ_TOOLS,
      ...EDIT_TOOLS,
      ...attachmentReadRules(context),
      ...allowCommands.map((pattern) => `Bash(${pattern})`),
      ...mcpTools(context),
    ];
  }
  return mcpTools(context);
}

export function claudePermissionArgs(context: LaunchContext): string[] {
  const { permissions, allowCommands } = context.specialist;
  if (permissions === 'full') return ['--dangerously-skip-permissions'];
  if (permissions === 'edit' && context.claudeEditMode !== 'allowlist') {
    // acceptEdits accepts file edits; auto lets the Claude Code classifier judge every action.
    // The allow_commands patterns stay allow rules in both, ahead of anything else.
    return [
      '--permission-mode',
      context.claudeEditMode === 'auto' ? 'auto' : 'acceptEdits',
      '--allowedTools',
      ...attachmentReadRules(context),
      ...allowCommands.map((pattern) => `Bash(${pattern})`),
      ...mcpTools(context),
    ];
  }
  return ['--permission-mode', 'default', '--allowedTools', ...claudeAllowedTools(context)];
}
