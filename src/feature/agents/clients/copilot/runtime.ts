import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:process';

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
import {
  attemptServers,
  conversationOf,
  gateFiles,
  serverNote,
  toolPolicy,
} from '../policy/index.ts';
import { hooksConfig, mcpConfig } from './config.ts';
import { COPILOT_REFUSAL } from './gate.ts';
import { createCopilotParser } from './parser.ts';
import { sandboxed } from './sandbox.ts';
import { copilotTranscript } from './transcript.ts';

const GITHUB_TOKENS = ['GITHUB_TOKEN', 'GH_TOKEN', 'COPILOT_GITHUB_TOKEN'];

/**
 * The provider variables of the own endpoint. With a provider the GitHub tokens are emptied: a
 * token of the user is never sent to a foreign endpoint, and the key of the provider is not one.
 */
function providerEnvironment(context: LaunchContext, extra: RuntimeExtra): Record<string, string> {
  const environment = { ...context.environment, ...extra.env };
  const baseUrl = environment.COPILOT_PROVIDER_BASE_URL?.trim();
  if (!baseUrl) return {};
  if (!/^https?:\/\/[^\s]+$/.test(baseUrl)) {
    throw new Error('COPILOT_PROVIDER_BASE_URL must be an http(s) URL');
  }
  const model = context.specialist.model ?? environment.COPILOT_MODEL;
  if (!model) throw new Error('copilot needs a model for COPILOT_PROVIDER_BASE_URL');
  return {
    COPILOT_PROVIDER_BASE_URL: baseUrl,
    COPILOT_PROVIDER_TYPE: environment.COPILOT_PROVIDER_TYPE ?? 'openai',
    COPILOT_MODEL: model,
    ...Object.fromEntries(GITHUB_TOKENS.map((name) => [name, ''])),
  };
}

function toolFlags(context: LaunchContext): string[] {
  const { permissions } = context.specialist;
  return [
    // the gate and the sandbox decide; the native rules only add to them
    '--allow-all-tools',
    ...PROTECTED_GIT_COMMANDS.map((command) => `--deny-tool=shell(${command})`),
    ...(permissions === 'read' ? ['--deny-tool=write', '--deny-tool=shell'] : []),
    ...(context.attachmentsDirectory ? ['--add-dir', context.attachmentsDirectory] : []),
  ];
}

function launch(executable: string, extra: RuntimeExtra, context: LaunchContext): Launch {
  const servers = attemptServers(context);
  const directory = conversationOf(context, 'copilot');
  const home = join(directory, 'copilot-home');
  // A resume never opens an empty home: the history of the session lives in `session-state`.
  if (context.resumeSession && !existsSync(join(home, 'session-state'))) {
    throw new Error(`copilot: the history of session ${context.resumeSession} is missing`);
  }
  const gate = gateFiles({
    directory: join(home, 'aip'),
    policy: toolPolicy(context, servers),
    module: 'copilot/gate',
    failure: COPILOT_REFUSAL,
  });
  const prompt = [
    systemPrompt(context.specialist, context.input),
    serverNote(servers),
    userMessage(context.input, context.attachmentsDirectory),
  ].join('\n\n');
  const tmp = join(directory, 'tmp');
  const args = [
    ...extra.args,
    '-p',
    prompt,
    '--output-format=json',
    '--no-ask-user',
    '--disable-builtin-mcps',
    ...toolFlags(context),
    ...(context.specialist.model ? ['--model', context.specialist.model] : []),
    // never `--continue` and never `--trust-folder`: the stored id names the conversation
    ...(context.resumeSession ? [`--session-id=${context.resumeSession}`] : []),
  ];
  const wrapped = sandboxed({
    platform,
    environment: { ...context.environment, ...extra.env },
    command: executable,
    args,
    worktree: context.worktree,
    privateDirectory: directory,
    conversationsRoot: dirname(directory),
    writeWorktree: context.specialist.permissions !== 'read',
    profilePath: join(directory, 'sandbox.sb'),
    readOnly: [join(home, 'aip'), join(home, 'hooks'), join(home, 'mcp-config.json')],
  });
  return {
    command: wrapped.command,
    args: wrapped.args,
    env: {
      ...extra.env,
      ...providerEnvironment(context, extra),
      COPILOT_HOME: home,
      TMPDIR: tmp,
    },
    files: [
      ...wrapped.files,
      ...gate.files,
      { path: join(tmp, '.keep'), content: '' },
      { path: join(home, 'mcp-config.json'), content: mcpConfig(servers) },
      { path: join(home, 'hooks', 'aip.json'), content: hooksConfig(gate.command) },
    ],
    sessionId: context.resumeSession,
  };
}

function oneShot(executable: string, extra: RuntimeExtra, request: OneShotRequest): Launch {
  return {
    command: executable,
    args: [
      ...extra.args,
      '-p',
      request.prompt,
      '--output-format=json',
      '--no-ask-user',
      '--disable-builtin-mcps',
      '--deny-tool=shell',
      '--deny-tool=write',
      '--model',
      request.model,
    ],
    env: { ...extra.env, COPILOT_HOME: join(request.directory, 'copilot-home') },
    files: [],
    sessionId: null,
  };
}

export function createCopilotRuntime(
  executable = 'copilot',
  extra: RuntimeExtra = { args: [], env: {} },
): Runtime {
  // The adapter is built per attempt: the parser checks the stream against the id it resumed.
  let expected: string | null = null;
  return {
    name: 'copilot',
    executable,
    builtinTools: [],
    listModels: () => Promise.resolve({ models: [], error: null }),
    buildLaunch(context) {
      expected = context.resumeSession;
      return launch(executable, extra, context);
    },
    buildOneShot: (request) => oneShot(executable, extra, request),
    createParser: () => createCopilotParser(expected),
    transcript: copilotTranscript,
    skillDirectories: (worktree, home) => [
      join(worktree, '.github', 'skills'),
      join(home, '.copilot', 'skills'),
    ],
  };
}
