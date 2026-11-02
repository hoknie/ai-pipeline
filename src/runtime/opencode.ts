import { join } from 'node:path';

import type { Usage } from '../core/index.ts';

import { systemPrompt, userMessage } from './message.ts';
import {
  PROTECTED_GIT_COMMANDS,
  type Launch,
  type OneShotRequest,
  type LaunchContext,
  type OutputParser,
  type Runtime,
} from './types.ts';
import { opencodeErrorText, opencodeTranscript } from './transcript.ts';

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

function numberAt(value: unknown, ...path: string[]): number | null {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'number' ? current : null;
}

function findSession(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['sessionID', 'sessionId', 'session_id']) {
    if (typeof record[key] === 'string') return record[key];
  }
  for (const nested of Object.values(record)) {
    const found = findSession(nested);
    if (found) return found;
  }
  return null;
}

function findStepFinish(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if ((record.type === 'step-finish' || record.type === 'step_finish') && 'tokens' in record)
    return record;
  for (const nested of Object.values(record)) {
    const found = findStepFinish(nested);
    if (found) return found;
  }
  return null;
}

export function createOpencodeRuntime(executable = 'opencode'): Runtime {
  return {
    name: 'opencode',
    executable,
    builtinTools: [],
    buildOneShot(request: OneShotRequest): Launch {
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
        args: ['run', '--format', 'json', '--agent', agent, '-m', request.model, request.prompt],
        env: { OPENCODE_CONFIG: configPath },
        files: [{ path: configPath, content: JSON.stringify(config, null, 2) }],
        sessionId: null,
      };
    },
    buildLaunch(context: LaunchContext): Launch {
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
          },
        },
      };
      return {
        command: executable,
        args: [
          'run',
          '--format',
          'json',
          '--dir',
          context.worktree,
          '--agent',
          agent,
          ...(context.specialist.model ? ['-m', context.specialist.model] : []),
          ...(context.resumeSession ? ['-s', context.resumeSession] : []),
          ...(context.specialist.permissions === 'full' ? ['--auto'] : []),
          userMessage(context.input),
        ],
        env: { OPENCODE_CONFIG: configPath },
        files: [{ path: configPath, content: JSON.stringify(config, null, 2) }],
        sessionId: context.resumeSession,
      };
    },
    transcript: opencodeTranscript,
    createParser(): OutputParser {
      let sessionId: string | null = null;
      let usage: Usage | null = null;
      let error: string | null = null;
      return {
        push(line: string) {
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            return;
          }
          sessionId ??= findSession(value);
          const step = findStepFinish(value);
          if (step) {
            const input =
              (numberAt(step, 'tokens', 'input') ?? 0) +
              (numberAt(step, 'tokens', 'cache', 'read') ?? 0) +
              (numberAt(step, 'tokens', 'cache', 'write') ?? 0);
            const output = numberAt(step, 'tokens', 'output') ?? 0;
            const cost = numberAt(step, 'cost');
            usage = {
              inputTokens: (usage?.inputTokens ?? 0) + input,
              outputTokens: (usage?.outputTokens ?? 0) + output,
              costUsd:
                cost === null && usage?.costUsd == null
                  ? null
                  : (usage?.costUsd ?? 0) + (cost ?? 0),
            };
          }
          if (
            typeof value === 'object' &&
            value !== null &&
            (value as Record<string, unknown>).type === 'error'
          ) {
            error = opencodeErrorText((value as Record<string, unknown>).error ?? value).slice(
              0,
              500,
            );
          }
        },
        outcome() {
          return { sessionId, usage, error, denials: [] };
        },
      };
    },
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
