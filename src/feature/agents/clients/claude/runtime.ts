import { join } from 'node:path';

import {
  PROTECTED_GIT_COMMANDS,
  systemPrompt,
  userMessage,
  type Launch,
  type LaunchContext,
  type OneShotRequest,
  type Runtime,
  type RuntimeExtra,
} from '../../types/index.ts';

import { createClaudeParser } from './parser.ts';
import {
  claudePermissionArgs,
  claudeTools,
  ownMcpServers,
  PROJECT_SETTINGS,
} from './permissions.ts';
import { claudeTranscript } from './transcript.ts';

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

function oneShot(executable: string, extra: RuntimeExtra, request: OneShotRequest): Launch {
  const mcpConfigPath = join(request.directory, 'mcp.json');
  return {
    command: executable,
    args: [
      ...extra.args,
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
    env: { ...extra.env },
    files: [{ path: mcpConfigPath, content: JSON.stringify({ mcpServers: {} }) }],
    sessionId: null,
  };
}

/** The arguments that tell Claude Code which session, model, tools and settings to use. */
function launchOptions(context: LaunchContext, mcpConfigPath: string): string[] {
  const session = context.resumeSession
    ? ['--resume', context.resumeSession]
    : ['--session-id', context.sessionId];
  const model = context.specialist.model ? ['--model', context.specialist.model] : [];
  const disallowed = (
    context.specialist.permissions === 'full' ? ['git push'] : PROTECTED_GIT_COMMANDS
  ).map((command) => `Bash(${command}:*)`);
  return [
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
    ...claudePermissionArgs(context),
    '--disallowedTools',
    ...disallowed,
  ];
}

function launch(executable: string, extra: RuntimeExtra, context: LaunchContext): Launch {
  const mcpConfigPath = join(context.attemptDirectory, 'mcp.json');
  const [workerCommand, ...workerArgs] = context.workerCommand;
  const mcpConfig = {
    mcpServers: {
      ...ownMcpServers(context),
      aip: { type: 'stdio', command: workerCommand, args: workerArgs },
    },
  };
  return {
    command: executable,
    args: [
      ...extra.args,
      '-p',
      userMessage(context.input),
      '--output-format',
      'stream-json',
      '--verbose',
      ...launchOptions(context, mcpConfigPath),
    ],
    // The report tool is loaded at once instead of through a tool search.
    env: { ...extra.env, ENABLE_TOOL_SEARCH: 'false' },
    files: [{ path: mcpConfigPath, content: JSON.stringify(mcpConfig, null, 2) }],
    sessionId: context.resumeSession ?? context.sessionId,
  };
}

export function createClaudeRuntime(
  executable = 'claude',
  extra: RuntimeExtra = { args: [], env: {} },
): Runtime {
  return {
    name: 'claude',
    executable,
    buildOneShot: (request) => oneShot(executable, extra, request),
    buildLaunch: (context) => launch(executable, extra, context),
    transcript: claudeTranscript,
    createParser: createClaudeParser,
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
