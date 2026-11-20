import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  codexRules,
  createCodexParser,
  createCodexRuntime,
  codexTranscript,
} from '../../../src/feature/agents/clients/codex/index.ts';
import { conversationContext } from './conversation-context.ts';

const file = (launch: { files: { path: string; content: string }[] }, name: string) =>
  launch.files.find((item) => item.path.endsWith(name))!.content;

describe('Codex launch', () => {
  it('runs `exec --json` in a private CODEX_HOME with the worker of this attempt only', () => {
    const context = conversationContext('codex');
    const launch = createCodexRuntime('/bin/codex', { args: ['--x'], env: { A: '1' } }).buildLaunch(
      context,
    );
    expect(launch.command).toBe('/bin/codex');
    expect(launch.args.slice(0, 3)).toEqual(['--x', 'exec', '--json']);
    expect(launch.args).not.toContain('--ephemeral');
    expect(launch.args).not.toContain('--last');
    expect(launch.env.CODEX_HOME).toBe(join(context.conversationDirectory!, 'codex-home'));
    expect(launch.env.A).toBe('1');
    const config = file(launch, 'config.toml');
    expect(config).toContain('model = "team-model"');
    expect(config).toContain('[mcp_servers.aip-attempt-1]');
    expect(config).toContain('enabled_tools = ["swarm_report"');
    expect(config).not.toContain('model_provider');
  });

  it('points at the Responses API with the name of the key variable, never the key', () => {
    const context = conversationContext('codex', {
      environment: { AIP_CODEX_BASE_URL: 'https://llm.example/v1' },
    });
    const launch = createCodexRuntime('codex', {
      args: [],
      env: { AIP_CODEX_API_KEY_ENV: 'TEAM_KEY', TEAM_KEY: 'sk-very-secret' },
    }).buildLaunch(context);
    const config = file(launch, 'config.toml');
    expect(config).toContain('model_provider = "aip"');
    expect(config).toContain('base_url = "https://llm.example/v1"');
    expect(config).toContain('env_key = "TEAM_KEY"');
    expect(config).toContain('wire_api = "responses"');
    const everything = JSON.stringify([launch.args, launch.files]);
    expect(everything).not.toContain('sk-very-secret');
  });

  it('refuses an endpoint that only speaks Chat Completions and a bad base URL', () => {
    const chat = conversationContext('codex', {
      environment: { AIP_CODEX_BASE_URL: 'https://x/v1', AIP_CODEX_WIRE_API: 'chat' },
    });
    expect(() => createCodexRuntime().buildLaunch(chat)).toThrow(/Responses API/);
    const bad = conversationContext('codex', { environment: { AIP_CODEX_BASE_URL: 'ftp://x' } });
    expect(() => createCodexRuntime().buildLaunch(bad)).toThrow(/http\(s\)/);
  });

  it('resumes the thread by id from the same home, and refuses a resume without a history', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-codex-'));
    const context = conversationContext('codex', { resumeSession: 'thread-7' }, root);
    expect(() => createCodexRuntime().buildLaunch(context)).toThrow(/history .* is missing/);
    mkdirSync(join(context.conversationDirectory!, 'codex-home', 'sessions'), { recursive: true });
    const launch = createCodexRuntime().buildLaunch(context);
    const at = launch.args.indexOf('resume');
    expect(launch.args.slice(at, at + 2)).toEqual(['resume', 'thread-7']);
    expect(launch.sessionId).toBe('thread-7');
  });

  it('maps the levels to the sandbox and the approval policy, and to rules for the commands', () => {
    const level = (permissions: 'read' | 'edit' | 'full') => {
      const context = conversationContext('codex');
      context.specialist.permissions = permissions;
      return { config: file(createCodexRuntime().buildLaunch(context), 'config.toml'), context };
    };
    expect(level('read').config).toContain('sandbox_mode = "read-only"');
    expect(level('read').config).toContain('approval_policy = "never"');
    const edit = level('edit');
    expect(edit.config).toContain('sandbox_mode = "workspace-write"');
    expect(edit.config).toContain('approval_policy = "untrusted"');
    expect(level('full').config).toContain('sandbox_mode = "danger-full-access"');
    const rules = codexRules(edit.context);
    expect(rules).toContain('pattern = ["git", "push"], decision = "forbidden"');
    expect(rules).toContain('pattern = ["npm", "test"], decision = "allow"');
    edit.context.specialist.allowCommands = ['git push*', 'npm run *x*'];
    expect(codexRules(edit.context)).not.toContain('"allow"');
    const read = conversationContext('codex');
    read.specialist.permissions = 'read';
    expect(codexRules(read)).not.toContain('"allow"');
  });

  it('registers the servers of the specialist next to the worker under unique names', () => {
    const context = conversationContext('codex');
    context.specialist.mcp = { graph: { command: '/bin/graph', args: ['--a'], env: { K: 'v' } } };
    const config = file(createCodexRuntime().buildLaunch(context), 'config.toml');
    expect(config).toContain('[mcp_servers.aip-attempt-1-graph]');
    expect(config).toContain('command = "/bin/graph"');
    expect(config).toContain('env = { K = "v" }');
  });

  it('rewrites the config on every attempt: no worker of an earlier attempt stays', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-codex-'));
    const first = createCodexRuntime().buildLaunch(conversationContext('codex', {}, root));
    const second = createCodexRuntime().buildLaunch(
      conversationContext('codex', { sessionId: 'attempt-2' }, root),
    );
    expect(file(first, 'config.toml')).toContain('aip-attempt-1');
    expect(file(second, 'config.toml')).not.toContain('aip-attempt-1');
    expect(first.files[0]!.path).toBe(second.files[0]!.path);
  });

  it('needs a private conversation folder', () => {
    const context = conversationContext('codex', { conversationDirectory: null });
    expect(() => createCodexRuntime().buildLaunch(context)).toThrow(
      /no private conversation state/,
    );
  });

  it('asks a one-shot question without tools and without a stored session', () => {
    const launch = createCodexRuntime().buildOneShot({
      prompt: 'name it',
      model: 'm',
      directory: '/d',
    });
    expect(launch.args).toContain('--ephemeral');
    expect(file(launch, 'config.toml')).toContain('sandbox_mode = "read-only"');
    expect(JSON.stringify(launch.files)).not.toContain('mcp_servers');
  });
});

const lines = [
  JSON.stringify({ type: 'thread.started', thread_id: 'th-1' }),
  JSON.stringify({ type: 'turn.started' }),
  'a noisy line that is not JSON',
  JSON.stringify({
    type: 'item.completed',
    item: { id: 'a', type: 'agent_message', text: 'Hello' },
  }),
  JSON.stringify({
    type: 'item.started',
    item: { id: 'c', type: 'command_execution', command: 'npm test' },
  }),
  JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'c',
      type: 'command_execution',
      command: 'npm test',
      aggregated_output: 'ok',
      exit_code: 0,
    },
  }),
  JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'm',
      type: 'mcp_tool_call',
      server: 's',
      tool: 'swarm_report',
      arguments: { verdict: 'done' },
      status: 'completed',
    },
  }),
  JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 },
  }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
];

describe('Codex output', () => {
  it('takes the thread id and counts the tokens of this process only', () => {
    const parser = createCodexParser();
    for (const line of lines) parser.push(line);
    expect(parser.outcome()).toEqual({
      sessionId: 'th-1',
      usage: { inputTokens: 110, outputTokens: 25 },
      error: null,
      denials: [],
    });
  });

  it('reports a failed turn, and forgets a retried error', () => {
    const failed = createCodexParser();
    failed.push(JSON.stringify({ type: 'turn.failed', error: { message: 'quota' } }));
    expect(failed.outcome().error).toBe('quota');
    const retried = createCodexParser();
    retried.push(JSON.stringify({ type: 'error', message: 'Reconnecting 1/5' }));
    retried.push(
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    expect(retried.outcome().error).toBeNull();
    expect(createCodexParser().outcome().usage).toBeNull();
  });

  it('reads the log as a transcript and keeps what it cannot read as raw', () => {
    const entries = codexTranscript(lines);
    expect(entries.map((entry) => entry.kind)).toEqual([
      'raw',
      'text',
      'tool_call',
      'tool_result',
      'tool_result',
      'result',
      'result',
    ]);
    expect(entries[0]).toMatchObject({ kind: 'raw', text: 'a noisy line that is not JSON' });
    expect(
      codexTranscript([JSON.stringify({ type: 'turn.failed', error: { message: 'x' } })])[0],
    ).toMatchObject({
      kind: 'result',
      error: true,
    });
  });
});
