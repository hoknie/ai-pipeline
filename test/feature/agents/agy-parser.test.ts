import { describe, expect, it } from 'vitest';
import { createAgyParser, agyTranscript } from '../../../src/feature/agents/clients/agy/index.ts';

const step = (index: number, input: number, state = 'DONE') =>
  JSON.stringify({
    event: 'step_update',
    step_update: {
      conversation_id: 'conv-1',
      step_index: index,
      state,
      step_type: 'agent_response',
      usage: { input_tokens: input, output_tokens: 5, thinking_tokens: 3, cache_read_tokens: 10 },
    },
  });

describe('Antigravity output', () => {
  it('replaces usage of the same step, counts distinct steps and retains it without a result', () => {
    const parser = createAgyParser();
    parser.push(step(1, 100, 'ACTIVE'));
    parser.push(step(1, 120));
    parser.push(step(2, 30));
    expect(parser.outcome()).toEqual({
      sessionId: 'conv-1',
      error: null,
      denials: [],
      usage: { inputTokens: 150, outputTokens: 10, costUsd: null },
    });
    const copy = parser.usage()!;
    copy.inputTokens = 1;
    expect(parser.usage()?.inputTokens).toBe(150);
  });

  it('uses a first conversation result to correct usage without adding cache or thinking twice', () => {
    const parser = createAgyParser();
    parser.push(step(1, 100));
    parser.push(
      JSON.stringify({
        event: 'result',
        result: {
          status: 'SUCCESS',
          conversation_id: 'conv-2',
          num_turns: 1,
          usage: { input_tokens: 130, output_tokens: 7 },
        },
      }),
    );
    expect(parser.outcome().sessionId).toBe('conv-2');
    expect(parser.usage()).toEqual({ inputTokens: 130, outputTokens: 7, costUsd: null });
  });

  it.each([true, false])(
    'never bills old turns from a resumed result (step usage: %s)',
    (steps) => {
      const parser = createAgyParser();
      if (steps) parser.push(step(10, 30));
      parser.push(
        JSON.stringify({
          event: 'result',
          result: {
            status: 'SUCCESS',
            num_turns: 2,
            usage: { input_tokens: 130, output_tokens: 50 },
          },
        }),
      );
      expect(parser.usage()).toEqual(
        steps ? { inputTokens: 30, outputTokens: 5, costUsd: null } : null,
      );
    },
  );

  it.each(['ERROR', 'WAITING', 'CANCELED', 'INTERRUPTED', 'INVALID'])(
    'records terminal %s and keeps reading after malformed events',
    (status) => {
      const parser = createAgyParser();
      for (const line of [
        'diagnostic',
        '{',
        '{"event":"future"}',
        '{"event":"step_update","step_update":{}}',
      ])
        parser.push(line);
      parser.push('{"event":"init","conversation_id":"conv-1","init":{"future":true}}');
      parser.push(
        JSON.stringify({ event: 'result', result: { status, error: 'model unavailable' } }),
      );
      expect(parser.outcome()).toMatchObject({
        sessionId: 'conv-1',
        error: 'model unavailable',
        usage: null,
      });
    },
  );

  it('keeps an unknown status visible even without an error string', () => {
    const parser = createAgyParser();
    parser.push('{"event":"result","result":{"status":"RUNNING"}}');
    expect(parser.outcome().error).toContain('RUNNING');
  });
});

describe('Antigravity transcript', () => {
  it('keeps deltas in order, pairs a repeated tool step once, preserves times and raw diagnostics', () => {
    const tool = {
      step_index: 4,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'run_command',
      tool_info: { name: 'run_command', parameters: { CommandLine: 'npm test' } },
    };
    const lines = [
      '{"event":"init","conversation_id":"conv-1"}',
      ...['hello', ' world'].map((text_delta) =>
        JSON.stringify({
          event: 'step_update',
          step_update: {
            step_index: 2,
            state: 'ACTIVE',
            step_type: 'agent_response',
            text_delta,
          },
        }),
      ),
      JSON.stringify({ event: 'step_update', step_update: tool }),
      JSON.stringify({
        event: 'step_update',
        step_update: { ...tool, state: 'DONE', tool_info: { ...tool.tool_info, output: 'passed' } },
      }),
      'diagnostic',
      '{"event":"result","result":{"status":"ERROR","error":"failed"}}',
    ];
    const entries = agyTranscript(lines, [1, 2, 3, 4, 5, 6, 7]);
    expect(entries.filter((entry) => entry.kind === 'text').map((entry) => entry.text)).toEqual([
      'hello',
      ' world',
    ]);
    expect(entries.filter((entry) => entry.kind === 'text').map((entry) => entry.streamId)).toEqual(
      ['agy:agent-response:2', 'agy:agent-response:2'],
    );
    const firstPage = agyTranscript(lines.slice(1, 2), [2]);
    const secondPage = agyTranscript(lines.slice(2, 3), [3]);
    const paged = [...firstPage, ...secondPage];
    expect(paged.filter((entry) => entry.kind === 'text')).toEqual(
      entries.filter((entry) => entry.kind === 'text'),
    );
    expect(paged.map((entry) => entry.at)).toEqual([2, 3]);
    expect(
      agyTranscript([
        JSON.stringify({
          event: 'step_update',
          step_update: {
            step_index: 3,
            state: 'ACTIVE',
            step_type: 'agent_response',
            text_delta: 'x',
          },
        }),
        JSON.stringify({
          event: 'step_update',
          step_update: {
            step_index: 4,
            state: 'ACTIVE',
            step_type: 'agent_response',
            text_delta: 'y',
          },
        }),
      ])
        .filter((entry) => entry.kind === 'text')
        .map((entry) => entry.streamId),
    ).toEqual(['agy:agent-response:3', 'agy:agent-response:4']);
    expect(entries.filter((entry) => entry.kind === 'tool_call')).toHaveLength(1);
    expect(entries).toContainEqual({
      kind: 'tool_result',
      id: '4',
      text: 'passed',
      error: false,
      at: 5,
    });
    expect(entries).toContainEqual({ kind: 'raw', text: 'diagnostic', at: 6 });
    expect(entries.at(-1)).toMatchObject({ kind: 'result', text: 'failed', error: true, at: 7 });
  });

  it('preserves exact fragment text, timestamps and source lines including whitespace and empty deltas', () => {
    const deltas = ['Привет', ' ', 'мир', '\n\n', ''];
    const lines = deltas.map((text_delta) =>
      JSON.stringify({
        event: 'step_update',
        step_update: { step_index: 9, state: 'ACTIVE', step_type: 'agent_response', text_delta },
      }),
    );
    const original = [...lines];
    const entries = agyTranscript(lines, [10, 11, 12, 13, 14]);
    expect(entries.map((entry) => entry.kind === 'text' && entry.text)).toEqual(deltas);
    expect(entries.map((entry) => entry.at)).toEqual([10, 11, 12, 13, 14]);
    expect(
      entries.every((entry) => entry.kind === 'text' && entry.streamId === 'agy:agent-response:9'),
    ).toBe(true);
    expect(
      entries
        .filter((entry) => entry.kind === 'text')
        .map((entry) => entry.text)
        .join(''),
    ).toBe('Привет мир\n\n');
    expect(lines).toEqual(original);
  });
});
