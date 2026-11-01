import { describe, expect, it } from 'vitest';

import { stepIds } from '../src/components/stepIds.ts';

const auto = (specialist: string) => ({ specialist, autoId: true, fixedId: '' });
const own = (specialist: string, fixedId: string) => ({ specialist, autoId: false, fixedId });

describe('stepIds', () => {
  it('uses the specialist and numbers a repeat', () => {
    expect(stepIds([auto('planner'), auto('coder'), auto('coder'), auto('coder')])).toEqual([
      'planner',
      'coder',
      'coder-2',
      'coder-3',
    ]);
  });

  it('does not take an id that a step from the file owns', () => {
    expect(stepIds([own('planner', 'coder'), auto('coder')])).toEqual(['coder', 'coder-2']);
    expect(stepIds([auto('coder'), own('planner', 'coder')])).toEqual(['coder-2', 'coder']);
  });

  it('gives an empty id to a step without a specialist', () => {
    expect(stepIds([auto(''), auto('coder')])).toEqual(['', 'coder']);
  });

  it('keeps the ids when the steps are reordered', () => {
    expect(stepIds([auto('coder'), auto('coder')])).toEqual(['coder', 'coder-2']);
    expect(stepIds([auto('a'), auto('coder'), auto('coder')].reverse())).toEqual([
      'coder',
      'coder-2',
      'a',
    ]);
  });
});
