import { describe, expect, it } from 'vitest';

import {
  isJsonSummary,
  parseJson,
  readableJson,
  readableSummary,
} from '../src/features/runs/transcript/jsonText.ts';

describe('parseJson', () => {
  it('returns objects and arrays only', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson(' [1,2] ')).toEqual([1, 2]);
    for (const text of ['42', '"a"', 'null', '{broken', '{"a":"cut', 'export const a = 1;'])
      expect(parseJson(text)).toBeUndefined();
  });
});

describe('readableJson', () => {
  it('writes key: value lines', () => {
    expect(readableJson({ status: 'running', parallel: 2 })).toBe('status: running\nparallel: 2');
  });

  it('indents nested values and marks items with a dash', () => {
    expect(readableJson({ todos: [{ content: 'Спека', status: 'done' }] })).toBe(
      'todos:\n  - content: Спека\n    status: done',
    );
    expect(readableJson(['a', 'b'])).toBe('- a\n- b');
  });

  it('puts a multi-line string in an indented block', () => {
    expect(readableJson({ text: 'one\ntwo' })).toBe('text:\n  one\n  two');
  });

  it('keeps empty containers and scalars as in JSON', () => {
    expect(readableJson({ a: {}, b: [], c: null, d: true, e: 3 })).toBe(
      'a: {}\nb: []\nc: null\nd: true\ne: 3',
    );
    expect(readableJson({})).toBe('{}');
  });
});

describe('readableSummary', () => {
  it('joins fields and folds nested values', () => {
    expect(readableSummary({ repo: '/w/app', a: { b: 1 }, c: [1, 2], d: 'x\ny' })).toBe(
      'repo: /w/app · a: {…} · c: [2] · d: x y',
    );
  });

  it('cuts to the limit with an ellipsis', () => {
    const text = readableSummary({ a: 'x'.repeat(300) });
    expect(text).toHaveLength(120);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('isJsonSummary', () => {
  it('recognizes the JSON fallback of the daemon, whole or cut', () => {
    const small = { repo: '/w/app' };
    expect(isJsonSummary(JSON.stringify(small), JSON.stringify(small, null, 2))).toBe(true);
    const big = { a: 'x'.repeat(300) };
    const json = JSON.stringify(big);
    expect(isJsonSummary(`${json.slice(0, 119)}…`, JSON.stringify(big, null, 2))).toBe(true);
  });

  it('does not take paths, commands and patterns for JSON', () => {
    for (const summary of ['src/app.ts', 'npm test', '[a-z]+'])
      expect(isJsonSummary(summary, '{"file_path":"src/app.ts"}')).toBe(false);
  });
});
