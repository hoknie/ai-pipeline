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

import { listOpencodeModels } from './models.ts';
import { createOpencodeParser } from './parser.ts';
import { opencodeTranscript } from './transcript.ts';

type Rule = 'allow' | 'deny' | 'ask';

export function opencodePermission(
  context: LaunchContext,
): Record<string, Rule | Record<string, Rule>> {
  const { permissions, allowCommands } = context.specialist;
  const protectedRules = Object.fromEntries(
    PROTECTED_GIT_COMMANDS.map((command) => [`${command}*`, 'deny' as Rule]),
  );
  if (permissions === 'read') return { edit: 'deny', bash: 'deny', webfetch: 'allow' };
  if (permissions === 'edit') {
    return {
      edit: 'allow',
      bash: {
        '*': 'deny',
        ...Object.fromEntries(allowCommands.map((pattern) => [pattern, 'allow' as Rule])),
        ...protectedRules,
      },
      webfetch: 'allow',
    };
  }
  return { edit: 'allow', bash: { '*': 'allow', 'git push*': 'deny' }, webfetch: 'allow' };
}

export function opencodeAgentName(slug: string): string {
  return `aip-${slug}`;
}

/**
 * `-m provider/model#variant`: OpenCode 2 has no `--variant` flag and names a variant only
 * together with a model, so a variant without a model is not passed (the configuration rejects it).
 */
function modelArgs(model: string | null | undefined, variant: string | undefined): string[] {
  if (!model) return [];
  return ['-m', variant ? `${model}#${variant}` : model];
}

/**
 * The launches run with `--standalone`: the background service of OpenCode 2 ignores
 * `OPENCODE_CONFIG` of the caller, so the generated agent and the worker MCP server would be
 * missing. The process runs in the worktree; OpenCode 2 takes it as the project directory.
 */
function oneShot(executable: string, extra: RuntimeExtra, request: OneShotRequest): Launch {
  const configPath = join(request.directory, 'opencode.json');
  const agent = 'aip-oneshot';
  const config = {
    $schema: 'https://opencode.ai/config.json',
    agent: {
      [agent]: {
        description: 'aip one-shot question without tools',
        mode: 'primary',
        permission: { edit: 'deny', bash: 'deny', webfetch: 'deny' },
      },
    },
  };
  return {
    command: executable,
    args: [
      ...extra.args,
      'run',
      '--standalone',
      '--format',
      'json',
      '--agent',
      agent,
      '-m',
      request.model,
      request.prompt,
    ],
    env: { ...extra.env, OPENCODE_CONFIG: configPath },
    files: [{ path: configPath, content: JSON.stringify(config, null, 2) }],
    sessionId: null,
  };
}

function launch(executable: string, extra: RuntimeExtra, context: LaunchContext): Launch {
  const configPath = join(context.attemptDirectory, 'opencode.json');
  const agent = opencodeAgentName(context.specialist.slug);
  const config = {
    $schema: 'https://opencode.ai/config.json',
    mcp: { aip: { type: 'local', command: context.workerCommand, enabled: true } },
    agent: {
      [agent]: {
        description: `aip specialist ${context.specialist.name}`,
        mode: 'primary',
        prompt: systemPrompt(context.specialist, context.input),
        permission: opencodePermission(context),
        ...(context.specialist.reasoningEffort
          ? { options: { reasoningEffort: context.specialist.reasoningEffort } }
          : {}),
      },
    },
  };
  return {
    command: executable,
    args: [
      ...extra.args,
      'run',
      '--standalone',
      '--format',
      'json',
      '--agent',
      agent,
      ...modelArgs(context.specialist.model, context.specialist.variant),
      ...(context.resumeSession ? ['-s', context.resumeSession] : []),
      ...(context.specialist.permissions === 'full' ? ['--auto'] : []),
      userMessage(context.input),
    ],
    env: { ...extra.env, OPENCODE_CONFIG: configPath },
    files: [{ path: configPath, content: JSON.stringify(config, null, 2) }],
    sessionId: context.resumeSession,
  };
}

export function createOpencodeRuntime(
  executable = 'opencode',
  extra: RuntimeExtra = { args: [], env: {} },
): Runtime {
  return {
    name: 'opencode',
    executable,
    builtinTools: [],
    listModels: (directory, run) => listOpencodeModels(executable, extra, directory, run),
    buildOneShot: (request) => oneShot(executable, extra, request),
    buildLaunch: (context) => launch(executable, extra, context),
    transcript: opencodeTranscript,
    createParser: createOpencodeParser,
    skillDirectories(worktree: string, home: string): string[] {
      return [
        join(home, '.config', 'opencode', 'skills'),
        join(worktree, '.opencode', 'skills'),
        join(home, '.config', 'opencode', 'command'),
        join(worktree, '.opencode', 'command'),
      ];
    },
  };
}
