import { describe, expect, it } from 'vitest';
import { overlay } from '../../../src/feature/agents/types/overlay.js';

describe('runtime settings overlay', () => {
  it('merges objects, replaces arrays and preserves unrelated settings', () => {
    const base = { nested: { a: 1, list: [1, 2] }, other: true };
    const top = { nested: { b: 2, list: [3] } };
    expect(overlay(base, top, [])).toEqual({ nested: { a: 1, b: 2, list: [3] }, other: true });
    expect(base).toEqual({ nested: { a: 1, list: [1, 2] }, other: true });
  });

  it('replaces owned agent nodes without inheriting permission rules', () => {
    const base = {
      agent: { 'aip-coder': { permission: { bash: { 'rm *': 'allow' } } }, other: { model: 'x' } },
    };
    const top = { agent: { 'aip-coder': { permission: { bash: { '*': 'deny' } } } } };
    expect(overlay(base, top, [['agent', 'aip-coder']])).toEqual({
      agent: { 'aip-coder': top.agent['aip-coder'], other: { model: 'x' } },
    });
  });
});
