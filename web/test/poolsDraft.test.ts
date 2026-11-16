import { describe, expect, it } from 'vitest';

import {
  bindPoolErrors,
  memberProblem,
  poolProblems,
  poolsFromValue,
  poolsToValue,
  selectorProblem,
  selectorsOverlap,
  type PoolDraft,
} from '../src/shared/ui/forms/settings/poolsDraft.ts';

const pool = (name: string, max: number | null, members: string[]): PoolDraft => ({
  name,
  max,
  members,
});

describe('pools draft', () => {
  it('turns the object of the file into a draft and back', () => {
    const value = { claude: { max: 2, members: ['claude'] }, glm: { max: 1, members: ['a', 'b'] } };
    const draft = poolsFromValue(value);
    expect(draft).toEqual([pool('claude', 2, ['claude']), pool('glm', 1, ['a', 'b'])]);
    expect(poolsToValue(draft)).toEqual(value);
  });

  it('reads anything that is not an object as no pools, and no pools write null', () => {
    expect(poolsFromValue(null)).toEqual([]);
    expect(poolsFromValue(['a'])).toEqual([]);
    expect(poolsToValue([])).toBeNull();
  });

  it('trims names and selectors on the way out', () => {
    expect(poolsToValue([pool(' a ', 1, [' claude '])])).toEqual({
      a: { max: 1, members: ['claude'] },
    });
  });

  it('finds empty and repeated names, empty lists, repeated selectors and a bad limit', () => {
    const problems = poolProblems([
      pool('', 1, ['claude']),
      pool('a', 1, ['x', 'x']),
      pool('a', 40, []),
      pool('b', null, [' ']),
    ]);
    expect(problems).toEqual([
      { pool: 0, member: null, problem: 'emptyName' },
      { pool: 1, member: 1, problem: 'duplicateMember' },
      { pool: 2, member: null, problem: 'duplicateName' },
      { pool: 2, member: null, problem: 'max' },
      { pool: 2, member: null, problem: 'noMembers' },
      { pool: 3, member: null, problem: 'max' },
      { pool: 3, member: null, problem: 'noMembers' },
    ]);
    expect(poolProblems([pool('a', 1, ['claude'])])).toEqual([]);
  });

  it('ties the errors of the daemon to the pool and the selector, names with dots included', () => {
    const pools = [pool('a', 1, ['x']), pool('a.b', 1, ['y', 'z'])];
    const bound = bindPoolErrors(pools, [
      { path: 'swarm.queue.pools.a.members[0]', message: 'one' },
      { path: 'swarm.queue.pools.a.b.members[1]', message: 'two' },
      { path: 'swarm.queue.pools.a.b.max', message: 'three' },
      { path: 'swarm.queue.default_pool', message: 'four' },
      { path: 'swarm.max', message: 'other' },
    ]);
    expect(bound).toEqual([
      { pool: 0, member: 0, message: 'one' },
      { pool: 1, member: 1, message: 'two' },
      { pool: 1, member: null, message: 'three' },
      { pool: -1, member: null, message: 'swarm.queue.default_pool: four' },
    ]);
  });

  it('checks the format of a selector like the daemon', () => {
    for (const ok of ['claude', 'agy', 'opencode', 'opencode:zai/*', 'opencode:google/gemini-2']) {
      expect(selectorProblem(ok)).toBeNull();
    }
    expect(selectorProblem('gpt-4')).toBe('format');
    expect(selectorProblem('opencode:google')).toBe('format');
    expect(selectorProblem('opencode:google/')).toBe('noModel');
  });

  it('finds overlapping selectors in any order', () => {
    expect(selectorsOverlap('opencode:google/*', 'opencode:google/gemini-2')).toBe(true);
    expect(selectorsOverlap('opencode:google/gemini-2', 'opencode:google/*')).toBe(true);
    expect(selectorsOverlap('opencode:google/*', 'opencode:google/gem*')).toBe(true);
    expect(selectorsOverlap('opencode:google/*', 'opencode:openai/*')).toBe(false);
    expect(selectorsOverlap('opencode', 'opencode:google/*')).toBe(false);
    expect(selectorsOverlap('opencode:Google/*', 'opencode:google/*')).toBe(false);
  });

  it('refuses a selector for its format, a repeat or an overlap with another pool', () => {
    const pools = [pool('a', 1, ['claude']), pool('b', 1, ['opencode:google/*'])];
    expect(memberProblem(pools, 0, 'gpt-4')).toEqual({ problem: 'format' });
    expect(memberProblem(pools, 0, 'opencode:google/')).toEqual({ problem: 'noModel' });
    expect(memberProblem(pools, 0, 'claude')).toEqual({ problem: 'duplicateMember' });
    expect(memberProblem(pools, 0, 'opencode:google/gemini-2')).toEqual({
      problem: 'overlap',
      pool: 'b',
      with: 'opencode:google/*',
    });
    expect(memberProblem(pools, 1, 'agy')).toBeNull();
  });

  it('finds bad and overlapping selectors that came from the file', () => {
    const problems = poolProblems([
      pool('a', 1, ['opencode:google/*']),
      pool('b', 1, ['opencode:google/gemini-2', 'gpt-4']),
    ]);
    expect(problems).toEqual([
      { pool: 1, member: 0, problem: 'overlap' },
      { pool: 1, member: 1, problem: 'format' },
    ]);
  });
});
