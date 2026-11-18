import { describe, expect, it } from 'vitest';

import {
  SHARED_CHOICE,
  configChoices,
  filterChoices,
  initialChoice,
  sharedView,
} from '../src/features/repositories/index.ts';
import { groupRows, type ProjectRef } from '../src/shared/lib/catalog/projectRows.ts';
import { configView } from './fixtures.ts';

const ref = (slug: string, label = slug): ProjectRef => ({
  path: `/work/${slug}`,
  slug,
  label,
  color: null,
});
type Level = 'project' | 'global' | 'project_over_global';
type Row = { slug: string; level: Level };

const rowOf = (entries: [ProjectRef, Level][]) =>
  groupRows(
    entries.map(([project, level]) => ({ project, entries: [{ slug: 'x', level } as Row] })),
    (entry) => entry.slug,
  )[0]!;

describe('configChoices', () => {
  it('puts the shared choice first and leaves out the projects that use it as it is', () => {
    const row = rowOf([
      [ref('app'), 'global'],
      [ref('lib'), 'project_over_global'],
    ]);
    const choices = configChoices(row, null);
    expect(choices.map((c) => c.value)).toEqual([SHARED_CHOICE, 'lib']);
    expect(choices[0]!.project.slug).toBe('app');
  });

  it('points the shared choice at a project with the shared source when none uses it as it is', () => {
    const row = rowOf([
      [ref('app'), 'project'],
      [ref('lib'), 'project_over_global'],
    ]);
    expect(configChoices(row, null)[0]!.project.slug).toBe('lib');
  });

  it('has no shared choice when only projects have the entry', () => {
    const row = rowOf([
      [ref('app'), 'project'],
      [ref('lib'), 'project'],
    ]);
    expect(configChoices(row, null).map((c) => c.value)).toEqual(['app', 'lib']);
  });

  it('sorts the projects by name without regard to case, then by path', () => {
    const row = rowOf([
      [ref('p1', 'zeta'), 'project'],
      [ref('p2', 'Alpha'), 'project'],
      [{ ...ref('p3', 'alpha'), path: '/a/other' }, 'project'],
      [ref('p4', 'beta'), 'global'],
    ]);
    expect(configChoices(row, null).map((c) => c.value)).toEqual([SHARED_CHOICE, 'p3', 'p2', 'p1']);
  });

  it('picks the project of the address, the shared choice it uses, else the first', () => {
    const row = rowOf([
      [ref('app'), 'global'],
      [ref('lib'), 'project_over_global'],
      [ref('docs'), 'project'],
    ]);
    const choices = configChoices(row, 'app');
    expect(choices[0]!.project.slug).toBe('app');
    expect(initialChoice(choices, row, 'lib')?.value).toBe('lib');
    expect(initialChoice(choices, row, 'app')?.value).toBe(SHARED_CHOICE);
    expect(initialChoice(choices, row, null)?.value).toBe(SHARED_CHOICE);
    expect(initialChoice([], row, null)).toBeNull();
  });
});

describe('filterChoices', () => {
  const row = rowOf([
    [ref('g', 'global'), 'global'],
    [ref('lib', 'Library'), 'project'],
    [ref('doc', 'Docs'), 'project'],
  ]);
  const choices = configChoices(row, null);
  it('keeps everything for an empty text', () => {
    expect(filterChoices(choices, '  ').length).toBe(3);
  });
  it('finds a project by label or slug and keeps the shared choice', () => {
    expect(filterChoices(choices, 'li').map((c) => c.value)).toEqual([SHARED_CHOICE, 'lib']);
    expect(filterChoices(choices, 'DOC').map((c) => c.value)).toEqual([SHARED_CHOICE, 'doc']);
  });
  it('leaves only the shared choice when nothing matches', () => {
    expect(filterChoices(choices, 'zzz').map((c) => c.value)).toEqual([SHARED_CHOICE]);
  });
});

describe('sharedView', () => {
  const global = { file: '/g.yaml', revision: 'g', raw: { name: 'Shared' } };
  const own = { file: '/p.yaml', revision: 'p', raw: { name: 'Own' } };
  const entry = (key: Record<string, string>) => ({
    ...key,
    level: 'project_over_global' as const,
    file: '/p.yaml',
    revision: 'p',
    raw: own.raw,
    sources: { project: own, global },
  });

  it.each([
    ['pipelines', 'id'],
    ['actions', 'id'],
    ['specialists', 'slug'],
    ['chains', 'slug'],
  ] as const)('replaces an entry of %s with its shared file', (collection, field) => {
    const view = {
      ...configView({}),
      [collection]: [entry({ [field]: 'e' }), entry({ [field]: 'other' })],
    } as never;
    const result = sharedView(view, collection, 'e') as unknown as Record<
      string,
      { level: string; file: string; raw: unknown; sources: object }[]
    >;
    expect(result[collection]![0]).toMatchObject({
      level: 'global',
      file: '/g.yaml',
      raw: global.raw,
      sources: { global },
    });
    expect(result[collection]![1]!.level).toBe('project_over_global');
  });

  it('leaves a view without the collection as it is', () => {
    const view = { ...configView({}) } as Record<string, unknown>;
    delete view.actions;
    expect(sharedView(view as never, 'actions', 'e')).toBe(view);
  });
});
