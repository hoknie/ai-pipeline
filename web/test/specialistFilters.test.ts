import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTER,
  activeFilterCount,
  applyFilter,
  existingFilter,
  filterOptions,
  matchesLevel,
  matchesSearch,
  specialistValues,
} from '../src/specialistFilters.ts';

import { specialistEntry } from './fixtures.ts';

const coder = specialistEntry(
  'coder',
  { own_tags: ['fast'] },
  { model: 'opus', tools: ['Bash'], skills: ['review'], allow_commands: ['npm test*'] },
);
const plan = specialistEntry(
  'plan',
  { level: 'global', shared_tags: ['Backend'] },
  { runtime: 'opencode' },
);
const broken = specialistEntry('broken', {
  effective: null,
  raw: { name: 'Сломанный', model: 'x/y', tools: ['Read', 3] },
});
const all = [coder, plan, broken];

describe('specialist filters', () => {
  it('takes values from effective and from raw when invalid', () => {
    expect(specialistValues(coder).commands).toEqual(['npm test*']);
    expect(specialistValues(broken)).toMatchObject({
      model: 'x/y',
      tools: ['Read'],
      runtime: null,
    });
  });

  it('searches slug and name without case and edge spaces', () => {
    expect(matchesSearch(coder, '  CODE ')).toBe(true);
    expect(matchesSearch(broken, 'сломан')).toBe(true);
    expect(matchesSearch(plan, 'zzz')).toBe(false);
    expect(matchesSearch(plan, '  ')).toBe(true);
  });

  it('matches levels; an override fits both', () => {
    expect(matchesLevel('project', 'project_over_global')).toBe(true);
    expect(matchesLevel('global', 'project_over_global')).toBe(true);
    expect(matchesLevel('global', 'project')).toBe(false);
    expect(matchesLevel('all', 'global')).toBe(true);
  });

  it('uses OR inside a filter and AND between filters, keeping the order', () => {
    expect(
      applyFilter(all, { ...EMPTY_FILTER, runtimes: ['claude', 'opencode'] }, '').map(
        (e) => e.slug,
      ),
    ).toEqual(['coder', 'plan']);
    expect(
      applyFilter(all, { ...EMPTY_FILTER, runtimes: ['claude'], tools: ['Bash'] }, ''),
    ).toEqual([coder]);
    expect(applyFilter(all, { ...EMPTY_FILTER, tags: ['backend'] }, '')).toEqual([plan]);
    expect(
      applyFilter(all, { ...EMPTY_FILTER, models: ['opus', 'x/y'] }, '').map((e) => e.slug),
    ).toEqual(['coder', 'broken']);
    expect(applyFilter(all, { ...EMPTY_FILTER, models: ['opus'] }, 'plan')).toEqual([]);
  });

  it('lists distinct sorted options and drops vanished values', () => {
    const options = filterOptions(all);
    expect(options.tools).toEqual(['Bash', 'Read']);
    expect(options.runtimes).toEqual(['claude', 'opencode']);
    const next = existingFilter(
      { ...EMPTY_FILTER, tools: ['Bash', 'gone'], tags: ['BACKEND', 'nope'] },
      options,
    );
    expect(next.tools).toEqual(['Bash']);
    expect(next.tags).toEqual(['Backend']);
  });

  it('counts the level and every non-empty list', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(
      activeFilterCount({ ...EMPTY_FILTER, level: 'global', tags: ['a', 'b'], skills: ['s'] }),
    ).toBe(3);
  });
});
