import { dirname, join } from 'node:path';

import {
  systemPrompt,
  userMessage,
  workerToolNames,
  type Launch,
  type LaunchContext,
  type OneShotRequest,
  type Runtime,
  type RuntimeExtra,
} from '../../types/index.ts';
import { createAgyParser } from './parser.ts';
import { agySettings, AGY_ONE_SHOT_SETTINGS } from './permissions.ts';
import { agyTranscript } from './transcript.ts';
import { agyHookFiles } from './hooks.ts';

function launch(executable: string, extra: RuntimeExtra, context: LaunchContext): Launch {
  // A unique name avoids a user's running `aip` MCP server taking this worker's name.
  const server = `aip-${context.sessionId}`;
  // A resumed conversation keeps its workspace folders, so every attempt of a group rewrites the same one.
  const directory = join(dirname(context.attemptDirectory), 'agy');
  const settingsPath = join(directory, 'settings.json');
  const [command, ...args] = context.workerCommand;
  const tools = workerToolNames({
    split: args.includes('--split'),
    queue: args.includes('--queue'),
    repair: args.includes('--repair'),
  });
  const policy = {
    worktree: context.worktree,
    permissions: context.specialist.permissions,
    allowCommands: context.specialist.allowCommands,
    server,
    tools,
  };
  return {
    command: executable,
    args: [
      ...extra.args,
      '-p',
      `${systemPrompt(context.specialist, context.input)}\n\nUse only the current MCP server \`${server}\` for aip tools, including swarm_report. Do not use a worker from an earlier attempt.\n\n${userMessage(context.input)}`,
      '--output-format',
      'stream-json',
      '--disable-slash-commands',
      '--add-dir',
      directory,
      '--settings',
      settingsPath,
      ...(context.specialist.model ? ['--model', context.specialist.model] : []),
      ...(context.resumeSession ? ['--conversation', context.resumeSession] : []),
    ],
    env: { ...extra.env },
    files: [
      ...agyHookFiles(directory, policy),
      { path: settingsPath, content: JSON.stringify(agySettings(context, server), null, 2) },
      {
        path: join(directory, '.agents', 'mcp_config.json'),
        content: JSON.stringify(
          {
            mcpServers: {
              [server]: {
                command,
                args,
                enabledTools: tools,
                tools: Object.fromEntries(tools.map((tool) => [tool, { eager: true }])),
              },
            },
          },
          null,
          2,
        ),
      },
    ],
    sessionId: context.resumeSession,
  };
}

function oneShot(executable: string, extra: RuntimeExtra, request: OneShotRequest): Launch {
  const settingsPath = join(request.directory, 'agy-oneshot.json');
  return {
    command: executable,
    args: [
      ...extra.args,
      '-p',
      request.prompt,
      '--output-format',
      'stream-json',
      '--disable-slash-commands',
      '--add-dir',
      request.directory,
      '--settings',
      settingsPath,
      '--model',
      request.model,
    ],
    env: { ...extra.env },
    files: [
      { path: settingsPath, content: JSON.stringify(AGY_ONE_SHOT_SETTINGS) },
      ...agyHookFiles(request.directory, {
        worktree: request.directory,
        permissions: 'none',
        allowCommands: [],
        server: '',
        tools: [],
      }),
    ],
    sessionId: null,
  };
}

export function createAgyRuntime(
  executable = 'agy',
  extra: RuntimeExtra = { args: [], env: {} },
): Runtime {
  return {
    name: 'agy',
    executable,
    builtinTools: [],
    buildLaunch: (context) => launch(executable, extra, context),
    buildOneShot: (request) => oneShot(executable, extra, request),
    createParser: createAgyParser,
    transcript: agyTranscript,
    skillDirectories(worktree, home) {
      return [
        join(worktree, '.agents', 'skills'),
        join(home, '.gemini', 'config', 'skills'),
        join(home, '.gemini', 'antigravity-cli', 'skills'),
        join(home, '.gemini', 'skills'),
      ];
    },
  };
}
