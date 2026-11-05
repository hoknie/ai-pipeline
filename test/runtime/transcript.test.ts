import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { claudeTranscript, opencodeTranscript, toolSummary } from '../../src/runtime/index.ts';

const CWD = '/work/.aip/worktrees/r1/login';

const claudeLog = [
  JSON.stringify({ type: 'system', subtype: 'hook_started', hook_id: 'h' }),
  JSON.stringify({ type: 'system', subtype: 'init', cwd: CWD, session_id: 's', tools: [] }),
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: 'План:\n\n- прочитать `src/app.ts`\n- поправить' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${CWD}/src/app.ts` } },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '1\texport {}' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't2',
          is_error: true,
          content: [{ type: 'text', text: 'exit 1' }],
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'system',
    subtype: 'permission_denied',
    tool_use_id: 't3',
    message: 'This command requires approval',
  }),
  JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} }),
  'npm warn something odd',
  JSON.stringify({ type: 'surprise', value: 1 }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'готово',
    total_cost_usd: 0.25,
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 1000,
      output_tokens: 50,
    },
  }),
];

describe('claude transcript', () => {
  it('turns stream-json into text, tool calls, results and raw lines in order', () => {
    const entries = claudeTranscript(claudeLog);
    expect(entries.map((entry) => entry.kind)).toEqual([
      'text',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'tool_result',
      'raw',
      'raw',
      'result',
    ]);
    expect(entries[0]).toEqual({
      kind: 'text',
      text: 'План:\n\n- прочитать `src/app.ts`\n- поправить',
      at: null,
    });
    expect(entries[1]).toMatchObject({
      kind: 'tool_call',
      id: 't1',
      name: 'Read',
      summary: 'src/app.ts',
    });
    expect(entries[2]).toEqual({
      kind: 'tool_result',
      id: 't1',
      text: '1\texport {}',
      error: false,
      at: null,
    });
    expect(entries[3]).toMatchObject({ name: 'Bash', summary: 'npm test' });
    expect(entries[4]).toMatchObject({ text: 'exit 1', error: true });
    expect(entries[5]).toMatchObject({
      id: 't3',
      error: true,
      text: expect.stringContaining('approval'),
    });
    expect(entries[6]).toEqual({ kind: 'raw', text: 'npm warn something odd', at: null });
    expect(entries[8]).toEqual({
      kind: 'result',
      text: 'готово',
      error: false,
      verdict: null,
      inputTokens: 1110,
      outputTokens: 50,
      costUsd: 0.25,
      at: null,
    });
  });

  it('shows a refused call once, with the text of its error result', () => {
    const entries = claudeTranscript([
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't9', name: 'Bash', input: { command: 'rm -rf x' } }],
        },
      }),
      JSON.stringify({
        type: 'system',
        subtype: 'permission_denied',
        tool_use_id: 't9',
        message: 'needs approval',
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't9',
              is_error: true,
              content: 'This command requires approval',
            },
          ],
        },
      }),
    ]);
    expect(entries).toEqual([
      expect.objectContaining({ kind: 'tool_call', id: 't9' }),
      {
        kind: 'tool_result',
        id: 't9',
        text: 'permission denied: This command requires approval',
        error: true,
        at: null,
      },
    ]);
  });

  it('cuts very long texts', () => {
    const long = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'x'.repeat(30_000) }] },
    });
    const [entry] = claudeTranscript([long]);
    expect(entry?.kind === 'text' && entry.text.length).toBeLessThan(21_000);
    expect(entry?.kind === 'text' && entry.text).toContain('more characters');
  });
});

describe('opencode transcript', () => {
  it('reads text, tool parts with their output and step totals', () => {
    const entries = opencodeTranscript([
      JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'Сделаю' } }),
      JSON.stringify({
        type: 'tool_use',
        part: {
          type: 'tool',
          tool: 'bash',
          callID: 'c1',
          state: { status: 'completed', input: { command: 'ls' }, output: 'a.ts' },
        },
      }),
      JSON.stringify({
        type: 'step_finish',
        part: { type: 'step-finish', tokens: { input: 7, output: 3 }, cost: 0.01 },
      }),
      'not json',
    ]);
    expect(entries).toEqual([
      { kind: 'text', text: 'Сделаю', at: null },
      expect.objectContaining({ kind: 'tool_call', id: 'c1', name: 'bash', summary: 'ls' }),
      { kind: 'tool_result', id: 'c1', text: 'a.ts', error: false, at: null },
      expect.objectContaining({ kind: 'result', inputTokens: 7, outputTokens: 3, costUsd: 0.01 }),
      { kind: 'raw', text: 'not json', at: null },
    ]);
  });
});

describe('tool summaries', () => {
  it('shows paths, commands, patterns and a short JSON otherwise', () => {
    expect(toolSummary('Write', { file_path: '/w/a.ts' }, '/w')).toBe('a.ts');
    expect(toolSummary('Grep', { pattern: 'todo', path: '/w/src' }, '/w')).toBe('todo in src');
    expect(toolSummary('mcp__aip__swarm_report', { verdict: 'done', summary: 'x' })).toBe('done');
    expect(toolSummary('Other', { value: 'y'.repeat(200) })).toHaveLength(120);
  });
});

describe('opencode transcript of a recorded run', () => {
  const lines = readFileSync(
    join(import.meta.dirname, '..', 'fixtures', 'opencode-run.jsonl'),
    'utf8',
  ).split('\n');

  it('shows text, the tool call with its result and the totals of each step, without raw lines', () => {
    const entries = opencodeTranscript(lines);
    expect(entries.map((entry) => entry.kind)).toEqual([
      'tool_call',
      'tool_result',
      'result',
      'text',
      'result',
    ]);
    expect(entries[0]).toMatchObject({ id: 'call-call1', name: 'bash', summary: 'ls' });
    expect(entries[1]).toEqual({
      kind: 'tool_result',
      id: 'call-call1',
      text: 'hello.txt\n',
      error: false,
      at: null,
    });
    expect(entries[3]).toEqual({ kind: 'text', text: 'OK', at: null });
    expect(entries[4]).toMatchObject({ inputTokens: 19090, outputTokens: 3, costUsd: 0 });
  });

  it('writes the message of an error event', () => {
    const [entry] = opencodeTranscript([
      JSON.stringify({
        type: 'error',
        error: { name: 'APIError', data: { message: 'limit exceeded', statusCode: 402 } },
      }),
    ]);
    expect(entry).toEqual({
      kind: 'tool_result',
      id: null,
      text: 'limit exceeded',
      error: true,
      at: null,
    });
  });
});

describe('times of the entries', () => {
  it('gives every claude entry the time of the line it came from', () => {
    const times = claudeLog.map((_, index) => 1_000 + index * 10);
    const entries = claudeTranscript(claudeLog, times);
    // the text and the Read call share the third line; its result is the fourth
    expect(entries[0]).toMatchObject({ kind: 'text', at: 1_020 });
    expect(entries[1]).toMatchObject({ kind: 'tool_call', id: 't1', at: 1_020 });
    expect(entries[2]).toMatchObject({ kind: 'tool_result', id: 't1', at: 1_030 });
    expect(entries[3]).toMatchObject({ name: 'Bash', at: 1_040 });
    expect(entries[4]).toMatchObject({ error: true, at: 1_050 });
    expect(entries[6]).toMatchObject({ kind: 'raw', at: 1_080 });
    expect(entries.at(-1)).toMatchObject({ kind: 'result', at: 1_100 });
  });

  it('takes the time of the result for a refused call', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't9', name: 'Bash', input: { command: 'rm x' } }],
        },
      }),
      JSON.stringify({ type: 'system', subtype: 'permission_denied', tool_use_id: 't9' }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't9', is_error: true, content: 'no' }],
        },
      }),
    ];
    const entries = claudeTranscript(lines, [10, 20, 30]);
    expect(entries.map((entry) => entry.at)).toEqual([10, 30]);
  });

  it('leaves the time empty for a line without one', () => {
    const entries = claudeTranscript(claudeLog.slice(0, 3), [null, null, 5]);
    expect(entries.map((entry) => entry.at)).toEqual([5, 5]);
    expect(claudeTranscript(claudeLog.slice(0, 3), []).map((entry) => entry.at)).toEqual([
      null,
      null,
    ]);
  });

  it('gives every opencode entry the time of its line', () => {
    const lines = [
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'Сделаю' } }),
      JSON.stringify({
        type: 'tool_use',
        part: {
          type: 'tool',
          tool: 'bash',
          callID: 'c1',
          state: { status: 'completed', input: { command: 'ls' }, output: 'a.ts' },
        },
      }),
      JSON.stringify({
        type: 'step_finish',
        part: { type: 'step-finish', tokens: { input: 7, output: 3 }, cost: 0.01 },
      }),
      'not json',
    ];
    const entries = opencodeTranscript(lines, [100, 200, 300, 400]);
    expect(entries.map((entry) => entry.at)).toEqual([100, 200, 200, 300, 400]);
  });
});
