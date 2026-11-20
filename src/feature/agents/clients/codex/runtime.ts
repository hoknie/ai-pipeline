import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  endpointOf,
  systemPrompt,
  userMessage,
  type Endpoint,
  type Launch,
  type LaunchContext,
  type OneShotRequest,
  type Runtime,
  type RuntimeExtra,
} from '../../types/index.ts';
import { attemptServers, conversationOf, serverNote } from '../policy/index.ts';
import { codexConfig, codexRules } from './config.ts';
import { createCodexParser } from './parser.ts';
import { codexTranscript } from './transcript.ts';

/** Codex speaks the Responses API only; an endpoint that answers Chat Completions cannot be used. */
function endpointFor(context: LaunchContext, extra: RuntimeExtra): Endpoint | null {
  const environment = { ...context.environment, ...extra.env };
  const wire = environment.AIP_CODEX_WIRE_API?.trim().toLowerCase();
  if (wire && wire !== 'responses') {
    throw new Error(
      'codex needs an endpoint with the Responses API (AIP_CODEX_WIRE_API=responses); Chat Completions is not supported',
    );
  }
  return endpointOf('codex', environment);
}

function launch(executable: string, extra: RuntimeExtra, context: LaunchContext): Launch {
  const servers = attemptServers(context);
  const home = join(conversationOf(context, 'codex'), 'codex-home');
  // A resume never opens an empty home: the history of the thread lives in it.
  if (context.resumeSession && !existsSync(join(home, 'sessions'))) {
    throw new Error(`codex: the history of conversation ${context.resumeSession} is missing`);
  }
  const prompt = [
    systemPrompt(context.specialist, context.input),
    serverNote(servers),
    userMessage(context.input, context.attachmentsDirectory),
  ].join('\n\n');
  return {
    command: executable,
    args: [
      ...extra.args,
      'exec',
      '--json',
      ...(context.resumeSession ? ['resume', context.resumeSession] : []),
      prompt,
    ],
    env: { ...extra.env, CODEX_HOME: home },
    files: [
      {
        path: join(home, 'config.toml'),
        content: codexConfig(context, servers, endpointFor(context, extra)),
      },
      { path: join(home, 'rules', 'aip.rules'), content: codexRules(context) },
    ],
    sessionId: context.resumeSession,
  };
}

function oneShot(executable: string, extra: RuntimeExtra, request: OneShotRequest): Launch {
  const home = join(request.directory, 'codex-home');
  const config = [
    `model = ${JSON.stringify(request.model)}`,
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    '',
  ].join('\n');
  return {
    command: executable,
    args: [...extra.args, 'exec', '--json', '--ephemeral', '--skip-git-repo-check', request.prompt],
    env: { ...extra.env, CODEX_HOME: home },
    files: [{ path: join(home, 'config.toml'), content: config }],
    sessionId: null,
  };
}

export function createCodexRuntime(
  executable = 'codex',
  extra: RuntimeExtra = { args: [], env: {} },
): Runtime {
  return {
    name: 'codex',
    executable,
    builtinTools: [],
    // no documented command lists the models of a custom provider: the model is typed by hand
    listModels: () => Promise.resolve({ models: [], error: null }),
    buildLaunch: (context) => launch(executable, extra, context),
    buildOneShot: (request) => oneShot(executable, extra, request),
    createParser: createCodexParser,
    transcript: codexTranscript,
    loadsExtraSkills: false,
    skillDirectories: (worktree, home) => [
      join(worktree, '.codex', 'skills'),
      join(home, '.codex', 'skills'),
    ],
  };
}
