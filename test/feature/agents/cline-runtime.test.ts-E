import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createClineParser,
  createClineRuntime,
  clineTranscript,
} from '../../../src/feature/agents/clients/cline/index.ts';
import { conversationContext } from './conversation-context.ts';

const settings = (launch: { files: { path: string; content: string }[] }) =>
  JSON.parse(launch.files.find((file) => file.path.endsWith('settings.json'))!.content);

describe('Cline launch', () => {
  it('uses one private --config and --data-dir per conversation, outside the worktree', () => {
    const context = conversationContext('cline');
    const launch = createClineRuntime('/bin/cline').buildLaunch(context);
    const at = (flag: string) => launch.args[launch.args.indexOf(flag) + 1];
    expect(at('--config')).toBe(join(context.conversationDirectory!, 'config'));
    expect(at('--data-dir')).toBe(join(context.conversationDirectory!, 'data'));
    expect(at('--config')!.startsWith(context.worktree)).toBe(false);
    expect(launch.args).toContain('--json');
    const other = createClineRuntime().buildLaunch(
      conversationContext('cline', { conversationDirectory: join(context.root, 'other') }),
    );
    expect(other.args[other.args.indexOf('--config') + 1]).not.toBe(at('--config'));
  });

  it('gives the key to the environment of the process, not to argv or to a file', () => {
    const context = conversationContext('cline', {
      environment: { AIP_CLINE_BASE_URL: 'https://llm.example/v1' },
    });
    const launch = createClineRuntime('cline', {
      args: [],
      env: { AIP_CLINE_API_KEY: 'sk-very-secret' },
    }).buildLaunch(context);
    expect(launch.env.OPENAI_API_KEY).toBe('sk-very-secret');
    expect(JSON.stringify([launch.args, launch.files])).not.toContain('sk-very-secret');
    expect(settings(launch)).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://llm.example/v1',
      model: 'team-model',
    });
  });

  it('writes an executable PreToolUse hook and no persistent MCP registration', () => {
    const launch = createClineRuntime().buildLaunch(conversationContext('cline'));
    const hook = launch.files.find((file) => file.path.endsWith('hooks/PreToolUse'))!;
    expect(hook.mode).toBe(0o700);
    expect(hook.content).toContain('gate.mjs');
    expect(Object.keys(settings(launch).mcpServers)).toEqual(['aip-attempt-1']);
    expect(launch.args).not.toContain('mcp');
  });

  it('continues a task by id and refuses a resume without its sessions', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-cline-'));
    const context = conversationContext('cline', { resumeSession: 'task-5' }, root);
    expect(() => createClineRuntime().buildLaunch(context)).toThrow(
      /sessions of task-5 are missing/,
    );
    mkdirSync(join(context.conversationDirectory!, 'data', 'sessions'), { recursive: true });
    const launch = createClineRuntime().buildLaunch(context);
    expect(launch.args[launch.args.indexOf('--id') + 1]).toBe('task-5');
  });
});

describe('Cline output', () => {
  const lines = [
    JSON.stringify({ type: 'task_started', taskId: 'task-1' }),
    'noise',
    JSON.stringify({ type: 'say', say: 'text', text: 'Hello' }),
    JSON.stringify({
      type: 'say',
      say: 'api_req_started',
      text: JSON.stringify({ tokensIn: 10, tokensOut: 4 }),
    }),
    JSON.stringify({
      type: 'say',
      say: 'api_req_started',
      text: JSON.stringify({ tokensIn: 5, tokensOut: 1 }),
    }),
    JSON.stringify({ type: 'say', say: 'command', text: 'npm test' }),
    JSON.stringify({ type: 'say', say: 'command_output', text: 'ok' }),
  ];

  it('keeps the task id and adds the requests of this process', () => {
    const parser = createClineParser();
    for (const line of lines) parser.push(line);
    expect(parser.outcome()).toMatchObject({
      sessionId: 'task-1',
      usage: { inputTokens: 15, outputTokens: 5 },
      error: null,
    });
    const failed = createClineParser();
    failed.push(JSON.stringify({ type: 'say', say: 'error', text: 'boom' }));
    expect(failed.outcome().error).toBe('boom');
  });

  it('reads the transcript and keeps the corrupt line raw', () => {
    expect(clineTranscript(lines).map((entry) => entry.kind)).toEqual([
      'raw',
      'text',
      'tool_call',
      'tool_result',
    ]);
  });
});
