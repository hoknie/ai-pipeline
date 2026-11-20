import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  endpointOf,
  systemPrompt,
  userMessage,
  type Launch,
  type LaunchContext,
  type OneShotRequest,
  type Runtime,
  type RuntimeExtra,
} from '../../types/index.ts';
import {
  attemptServers,
  conversationOf,
  gateFiles,
  serverNote,
  toolPolicy,
} from '../policy/index.ts';
import { CLINE_REFUSAL } from './gate.ts';
import { createClineParser } from './parser.ts';
import { clineTranscript } from './transcript.ts';

/**
 * The profile of one conversation: an OpenAI-compatible provider whose key is the name of a
 * variable, and the MCP servers of this attempt only. The file is replaced on every attempt.
 */
function profile(
  context: LaunchContext,
  extra: RuntimeExtra,
): { settings: Record<string, unknown>; env: Record<string, string> } {
  const servers = attemptServers(context);
  const environment = { ...context.environment, ...extra.env };
  const endpoint = endpointOf('cline', environment);
  const key = endpoint ? environment[endpoint.keyEnv] : undefined;
  return {
    settings: {
      ...(endpoint
        ? {
            provider: 'openai',
            baseUrl: endpoint.baseUrl,
            apiKeyEnv: 'OPENAI_API_KEY',
            ...(context.specialist.model ? { model: context.specialist.model } : {}),
          }
        : {}),
      mcpServers: {
        ...Object.fromEntries(
          servers.own.map((own) => [
            own.name,
            { command: own.command, args: own.args, env: own.env },
          ]),
        ),
        [servers.worker]: { command: servers.command, args: servers.args },
      },
    },
    // the value goes to the environment of the process, never to argv or to a file
    env: key ? { OPENAI_API_KEY: key } : {},
  };
}

function launch(executable: string, extra: RuntimeExtra, context: LaunchContext): Launch {
  const servers = attemptServers(context);
  const directory = conversationOf(context, 'cline');
  const config = join(directory, 'config');
  const data = join(directory, 'data');
  // A resume never opens an empty profile: the sessions live in the data directory.
  if (context.resumeSession && !existsSync(join(data, 'sessions'))) {
    throw new Error(`cline: the sessions of ${context.resumeSession} are missing`);
  }
  const gate = gateFiles({
    directory: join(config, 'aip'),
    policy: toolPolicy(context, servers),
    module: 'cline/gate',
    failure: CLINE_REFUSAL,
  });
  const { settings, env } = profile(context, extra);
  const prompt = [
    systemPrompt(context.specialist, context.input),
    serverNote(servers),
    userMessage(context.input, context.attachmentsDirectory),
  ].join('\n\n');
  return {
    command: executable,
    args: [
      ...extra.args,
      '--config',
      config,
      '--data-dir',
      data,
      '--json',
      '--auto-approve',
      'true',
      ...(context.resumeSession ? ['--id', context.resumeSession] : []),
      prompt,
    ],
    env: { ...extra.env, ...env },
    files: [
      ...gate.files,
      { path: join(config, 'settings.json'), content: JSON.stringify(settings, null, 2) },
      {
        // the hook is replaced with the policy of this attempt, so no earlier gate remains
        path: join(config, 'hooks', 'PreToolUse'),
        content: `#!/bin/sh\nexec ${gate.command}\n`,
        mode: 0o700,
      },
    ],
    sessionId: context.resumeSession,
  };
}

function oneShot(executable: string, extra: RuntimeExtra, request: OneShotRequest): Launch {
  const directory = join(request.directory, 'cline');
  return {
    command: executable,
    args: [
      ...extra.args,
      '--config',
      join(directory, 'config'),
      '--data-dir',
      join(directory, 'data'),
      '--json',
      '-m',
      request.model,
      request.prompt,
    ],
    env: { ...extra.env },
    files: [],
    sessionId: null,
  };
}

export function createClineRuntime(
  executable = 'cline',
  extra: RuntimeExtra = { args: [], env: {} },
): Runtime {
  return {
    name: 'cline',
    executable,
    builtinTools: [],
    // no documented command lists the models of an own endpoint: the model is typed by hand
    listModels: () => Promise.resolve({ models: [], error: null }),
    buildLaunch: (context) => launch(executable, extra, context),
    buildOneShot: (request) => oneShot(executable, extra, request),
    createParser: createClineParser,
    transcript: clineTranscript,
    loadsExtraSkills: false,
    skillDirectories: (worktree, home) => [
      join(worktree, '.cline', 'skills'),
      join(home, '.cline', 'skills'),
    ],
  };
}
