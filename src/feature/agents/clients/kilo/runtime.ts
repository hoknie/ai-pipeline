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
import { createOpencodeParser, opencodeTranscript } from '../opencode/index.ts';
import { attemptServers, conversationOf, serverNote } from '../policy/index.ts';
import { kiloConfig, kiloModel } from './config.ts';

/** The private XDG home of a conversation: its config, data (the history) and state. */
function xdg(directory: string): Record<string, string> {
  return {
    XDG_CONFIG_HOME: join(directory, 'xdg', 'config'),
    XDG_DATA_HOME: join(directory, 'xdg', 'data'),
    XDG_STATE_HOME: join(directory, 'xdg', 'state'),
    XDG_CACHE_HOME: join(directory, 'xdg', 'cache'),
  };
}

function launch(executable: string, extra: RuntimeExtra, context: LaunchContext): Launch {
  const servers = attemptServers(context);
  const directory = conversationOf(context, 'kilo');
  const env = xdg(directory);
  // A resume never opens an empty home: the history of the session lives in its data folder.
  if (context.resumeSession && !existsSync(env.XDG_DATA_HOME!)) {
    throw new Error(`kilo: the history of session ${context.resumeSession} is missing`);
  }
  const endpoint = endpointOf('kilo', { ...context.environment, ...extra.env });
  const model = kiloModel(context.specialist.model, endpoint);
  const prompt = [
    systemPrompt(context.specialist, context.input),
    serverNote(servers),
    userMessage(context.input, context.attachmentsDirectory),
  ].join('\n\n');
  return {
    command: executable,
    args: [
      ...extra.args,
      'run',
      '--format',
      'json',
      ...(model ? ['-m', model] : []),
      ...(context.resumeSession ? ['-s', context.resumeSession] : []),
      ...(context.specialist.permissions === 'full' ? ['--auto'] : []),
      prompt,
    ],
    env: { ...extra.env, ...env },
    files: [
      {
        path: join(env.XDG_CONFIG_HOME!, 'kilo', 'kilo.json'),
        content: JSON.stringify(kiloConfig(context, servers, endpoint), null, 2),
      },
    ],
    sessionId: context.resumeSession,
  };
}

function oneShot(executable: string, extra: RuntimeExtra, request: OneShotRequest): Launch {
  const env = xdg(join(request.directory, 'kilo'));
  const config = {
    $schema: 'https://app.kilo.ai/config.json',
    permission: { '*': 'deny' },
  };
  return {
    command: executable,
    args: [...extra.args, 'run', '--format', 'json', '-m', request.model, request.prompt],
    env: { ...extra.env, ...env },
    files: [
      { path: join(env.XDG_CONFIG_HOME!, 'kilo', 'kilo.json'), content: JSON.stringify(config) },
    ],
    sessionId: null,
  };
}

export function createKiloRuntime(
  executable = 'kilo',
  extra: RuntimeExtra = { args: [], env: {} },
): Runtime {
  return {
    name: 'kilo',
    executable,
    builtinTools: [],
    // the models of a custom provider have no documented listing: the model is typed by hand
    listModels: () => Promise.resolve({ models: [], error: null }),
    buildLaunch: (context) => launch(executable, extra, context),
    buildOneShot: (request) => oneShot(executable, extra, request),
    createParser: createOpencodeParser,
    transcript: opencodeTranscript,
    skillDirectories: (worktree, home) => [
      join(worktree, '.kilo', 'skills'),
      join(home, '.config', 'kilo', 'skills'),
    ],
  };
}
