import { join } from 'node:path';

import { z } from 'zod';

import type { Denial, Usage } from '../core/index.ts';

import { systemPrompt, userMessage } from './message.ts';
import {
  PROTECTED_GIT_COMMANDS,
  type Launch,
  type OneShotRequest,
  type LaunchContext,
  type OutputParser,
  type Runtime,
} from './types.ts';
import { claudeTranscript } from './transcript.ts';

const REPORT_TOOL = 'mcp__aip__swarm_report';
const QUEUE_TOOL = 'mcp__aip__swarm_queue_add';

/** The aip tools the specialist may call without asking: the report, and the queue when allowed. */
function aipTools(context: LaunchContext): string[] {
  return context.specialist.queue === true ? [REPORT_TOOL, QUEUE_TOOL] : [REPORT_TOOL];
}
/** Setting sources without the user's level: no personal hooks, plugins or permission rules. */
const PROJECT_SETTINGS = ['--setting-sources', 'project,local'];
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

const resultEvent = z.looseObject({
  type: z.literal('result'),
  session_id: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.unknown().optional(),
  total_cost_usd: z.number().optional(),
  permission_denials: z.unknown().optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

const sessionEvent = z.looseObject({ type: z.string(), session_id: z.string() });

const deniedCall = z.looseObject({
  tool_name: z.string(),
  tool_use_id: z.string().optional(),
  tool_input: z.unknown().optional(),
});

const deniedEvent = z.looseObject({
  type: z.literal('system'),
  subtype: z.literal('permission_denied'),
  tool_use_id: z.string().optional(),
  tool_name: z.string().optional(),
});

const toolUseMessage = z.looseObject({
  type: z.literal('assistant'),
  message: z.looseObject({ content: z.array(z.unknown()) }),
});

const toolUseBlock = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown().optional(),
});

function commandOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' ? command : null;
}

/** Refused tool calls of a stream, each once: Claude Code reports them as events and in the result. */
class Denials {
  private readonly calls = new Map<string, { tool: string; command: string | null }>();
  private readonly byId = new Map<string, Denial>();
  private readonly list: Denial[] = [];

  toolUse(id: string, tool: string, input: unknown): void {
    this.calls.set(id, { tool, command: commandOf(input) });
  }

  add(id: string | undefined, tool: string | undefined, input: unknown): void {
    const call = id !== undefined ? this.calls.get(id) : undefined;
    const denial: Denial = {
      tool: tool ?? call?.tool ?? 'unknown',
      command: commandOf(input) ?? call?.command ?? null,
    };
    if (id === undefined) {
      this.list.push(denial);
      return;
    }
    const known = this.byId.get(id);
    if (known) {
      if (known.command === null) known.command = denial.command;
      if (known.tool === 'unknown') known.tool = denial.tool;
      return;
    }
    this.byId.set(id, denial);
    this.list.push(denial);
  }

  values(): Denial[] {
    return this.list.map((denial) => ({ ...denial }));
  }
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

export function claudeAllowedTools(context: LaunchContext): string[] {
  const { permissions, allowCommands } = context.specialist;
  if (permissions === 'read') return [...READ_TOOLS, ...aipTools(context)];
  if (permissions === 'edit') {
    return [
      ...READ_TOOLS,
      ...EDIT_TOOLS,
      ...allowCommands.map((pattern) => `Bash(${pattern})`),
      ...aipTools(context),
    ];
  }
  return aipTools(context);
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
      ...allowCommands.map((pattern) => `Bash(${pattern})`),
      ...aipTools(context),
    ];
  }
  return ['--permission-mode', 'default', '--allowedTools', ...claudeAllowedTools(context)];
}

const CLAUDE_BUILTIN_TOOLS = [
  'Task',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'BashOutput',
  'KillShell',
  'NotebookEdit',
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'MultiEdit',
  'Write',
  'Bash',
];

export function createClaudeRuntime(executable = 'claude'): Runtime {
  return {
    name: 'claude',
    executable,
    buildOneShot(request: OneShotRequest): Launch {
      const mcpConfigPath = join(request.directory, 'mcp.json');
      return {
        command: executable,
        args: [
          '-p',
          request.prompt,
          '--output-format',
          'stream-json',
          '--verbose',
          '--model',
          request.model,
          '--no-session-persistence',
          ...PROJECT_SETTINGS,
          '--tools',
          '',
          '--mcp-config',
          mcpConfigPath,
          '--strict-mcp-config',
        ],
        env: {},
        files: [{ path: mcpConfigPath, content: JSON.stringify({ mcpServers: {} }) }],
        sessionId: null,
      };
    },
    buildLaunch(context: LaunchContext): Launch {
      const mcpConfigPath = join(context.attemptDirectory, 'mcp.json');
      const [workerCommand, ...workerArgs] = context.workerCommand;
      const mcpConfig = {
        mcpServers: { aip: { type: 'stdio', command: workerCommand, args: workerArgs } },
      };
      const session = context.resumeSession
        ? ['--resume', context.resumeSession]
        : ['--session-id', context.sessionId];
      const model = context.specialist.model ? ['--model', context.specialist.model] : [];
      const permissions = claudePermissionArgs(context);
      const disallowed = (
        context.specialist.permissions === 'full' ? ['git push'] : PROTECTED_GIT_COMMANDS
      ).map((command) => `Bash(${command}:*)`);
      return {
        command: executable,
        args: [
          '-p',
          userMessage(context.input),
          '--output-format',
          'stream-json',
          '--verbose',
          ...session,
          ...model,
          '--append-system-prompt',
          systemPrompt(context.specialist, context.input),
          '--tools',
          claudeTools(context).join(','),
          '--mcp-config',
          mcpConfigPath,
          ...(context.claudeMcp === 'isolated' ? ['--strict-mcp-config'] : []),
          ...(context.claudeSettings === 'isolated' ? PROJECT_SETTINGS : []),
          ...permissions,
          '--disallowedTools',
          ...disallowed,
        ],
        // The report tool is loaded at once instead of through a tool search.
        env: { ENABLE_TOOL_SEARCH: 'false' },
        files: [{ path: mcpConfigPath, content: JSON.stringify(mcpConfig, null, 2) }],
        sessionId: context.resumeSession ?? context.sessionId,
      };
    },
    transcript: claudeTranscript,
    createParser(): OutputParser {
      let sessionId: string | null = null;
      let usage: Usage | null = null;
      let error: string | null = null;
      const denials = new Denials();
      return {
        push(line: string) {
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            return;
          }
          const toolUse = toolUseMessage.safeParse(value);
          if (toolUse.success) {
            for (const block of toolUse.data.message.content) {
              const parsed = toolUseBlock.safeParse(block);
              if (parsed.success)
                denials.toolUse(parsed.data.id, parsed.data.name, parsed.data.input);
            }
          }
          const denied = deniedEvent.safeParse(value);
          if (denied.success) {
            denials.add(denied.data.tool_use_id, denied.data.tool_name, undefined);
            return;
          }
          const result = resultEvent.safeParse(value);
          if (result.success) {
            const event = result.data;
            if (Array.isArray(event.permission_denials)) {
              for (const item of event.permission_denials) {
                const call = deniedCall.safeParse(item);
                if (call.success) {
                  denials.add(call.data.tool_use_id, call.data.tool_name, call.data.tool_input);
                }
              }
            }
            sessionId = event.session_id ?? sessionId;
            const tokens = event.usage;
            if (tokens || event.total_cost_usd !== undefined) {
              usage = {
                inputTokens:
                  (tokens?.input_tokens ?? 0) +
                  (tokens?.cache_creation_input_tokens ?? 0) +
                  (tokens?.cache_read_input_tokens ?? 0),
                outputTokens: tokens?.output_tokens ?? 0,
                costUsd: event.total_cost_usd ?? null,
              };
            }
            if (event.is_error)
              error = typeof event.result === 'string' ? event.result : 'claude reported an error';
            return;
          }
          const session = sessionEvent.safeParse(value);
          if (session.success) sessionId = session.data.session_id;
        },
        outcome() {
          return { sessionId, usage, error, denials: denials.values() };
        },
      };
    },
    builtinTools: [...CLAUDE_BUILTIN_TOOLS],
    skillDirectories(worktree: string, home: string): string[] {
      return [
        join(worktree, '.claude', 'skills'),
        join(home, '.claude', 'skills'),
        join(worktree, '.claude', 'commands'),
        join(home, '.claude', 'commands'),
      ];
    },
  };
}
