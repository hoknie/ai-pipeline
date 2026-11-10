import { describe, expect, it } from 'vitest';
import { blocks } from '../src/features/runs/transcript/blocks.ts';
import type { TranscriptEntry } from '../src/shared/api/types.ts';

describe('transcript blocks', () => {
  it('joins adjacent fragments exactly and keeps the first timestamp without mutating inputs', () => {
    const input: TranscriptEntry[] = [
      { kind: 'text', text: '**Hel', streamId: 'x', at: 123 },
      { kind: 'text', text: 'lo**\n ', streamId: 'x', at: 456 },
      { kind: 'text', text: 'world', streamId: 'x' },
    ];
    const output = blocks(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      kind: 'entry',
      entry: { kind: 'text', text: '**Hello**\n world', at: 123 },
    });
    expect(input.map((entry) => entry.kind === 'text' && entry.text)).toEqual([
      '**Hel',
      'lo**\n ',
      'world',
    ]);
  });

  it('retains boundaries for distinct and standalone messages and hidden event types', () => {
    const input: TranscriptEntry[] = [
      { kind: 'text', text: 'a', streamId: 'x' },
      { kind: 'raw', text: '{}' },
      { kind: 'text', text: 'b', streamId: 'x' },
      { kind: 'text', text: 'complete' },
      { kind: 'text', text: 'c', streamId: 'x' },
    ];
    expect(
      blocks(input).filter((block) => block.kind === 'entry' && block.entry.kind === 'text'),
    ).toHaveLength(4);
  });

  it('preserves timestamps and does not cross stream, event, or tool-result boundaries', () => {
    const input: TranscriptEntry[] = [
      { kind: 'text', text: 'a', streamId: 'x', at: null },
      { kind: 'text', text: 'b', streamId: 'y', at: 2 },
      { kind: 'tool_call', id: 'c', name: 'tool', summary: '', input: '{}', at: 3 },
      { kind: 'text', text: 'c', streamId: 'x', at: 4 },
      { kind: 'text', text: 'd', streamId: 'x', at: 5 },
      { kind: 'tool_call', id: 'd', name: 'tool', summary: '', input: '{}', at: 6 },
      { kind: 'tool_result', id: 'd', text: 'done', error: false, at: 7 },
      {
        kind: 'result',
        text: 'finished',
        error: false,
        verdict: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        at: 8,
      },
      { kind: 'tool_result', id: 'missing', text: 'orphan', error: true, at: 9 },
      { kind: 'text', text: 'e', streamId: 'x' },
    ];
    const original = structuredClone(input);
    const output = blocks(input);
    expect(output).toHaveLength(8);
    expect(output[0]).toMatchObject({ kind: 'entry', entry: { text: 'a', at: null } });
    expect(output[1]).toMatchObject({ kind: 'entry', entry: { text: 'b', at: 2 } });
    expect(output[2]).toMatchObject({ kind: 'call', call: { id: 'c' }, results: [] });
    expect(output[3]).toMatchObject({ kind: 'entry', entry: { text: 'cd', at: 4 } });
    expect(output[4]).toMatchObject({
      kind: 'call',
      call: { id: 'd' },
      results: [{ text: 'done', at: 7 }],
    });
    expect(output[5]).toMatchObject({ kind: 'entry', entry: { kind: 'result', text: 'finished' } });
    expect(output[6]).toMatchObject({
      kind: 'entry',
      entry: { kind: 'tool_result', id: 'missing' },
    });
    expect(output[7]).toMatchObject({ kind: 'entry', entry: { text: 'e' } });
    expect(input).toEqual(original);
  });

  it('keeps late tool results as boundaries and preserves unknown first timestamps', () => {
    const output = blocks([
      { kind: 'tool_call', id: 'c', name: 'tool', summary: '', input: '{}' },
      { kind: 'text', text: 'x', streamId: 's' },
      { kind: 'tool_result', id: 'c', text: 'done', error: false },
      { kind: 'text', text: 'x', streamId: 's', at: 10 },
      { kind: 'text', text: 'late timestamp', streamId: 't', at: null },
      { kind: 'text', text: 'continued', streamId: 't', at: 20 },
    ]);
    expect(output).toHaveLength(4);
    expect(output[0]).toMatchObject({ kind: 'call', results: [{ text: 'done' }] });
    expect(output[1]).toMatchObject({ kind: 'entry', entry: { text: 'x' } });
    expect(output[2]).toMatchObject({ kind: 'entry', entry: { text: 'x' } });
    expect(output[3]).toMatchObject({
      kind: 'entry',
      entry: { kind: 'text', text: 'late timestampcontinued', at: null },
    });
    const timed = blocks([
      { kind: 'text', text: 'unknown', streamId: 't' },
      { kind: 'text', text: ' known later', streamId: 't', at: 20 },
    ]);
    expect(timed[0]).toMatchObject({ kind: 'entry', entry: { text: 'unknown known later' } });
    expect(
      timed[0]?.kind === 'entry' && timed[0].entry.kind === 'text' ? timed[0].entry.at : 1,
    ).toBeUndefined();
  });

  it('does not truncate a coalesced response at the single-entry text limit', () => {
    const text = 'x'.repeat(25_000);
    const output = blocks([
      { kind: 'text', text: text.slice(0, 10_000), streamId: 'long' },
      { kind: 'text', text: text.slice(10_000), streamId: 'long' },
    ]);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ kind: 'entry', entry: { text } });
  });
});
