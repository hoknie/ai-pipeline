import { describe, expect, it } from 'vitest';

import {
  SHARED_PROJECT,
  groupRows,
  inProjects,
  projectCounts,
  projectOptions,
  type ProjectRef,
} from '../src/shared/lib/catalog/projectRows.ts';

type Level = 'project' | 'global' | 'project_over_global';
type Row = { slug: string; level: Level };

const ref = (slug: string): ProjectRef => ({
  path: `/work/${slug}`,
  slug,
  label: slug,
  color: null,
});
const app = ref('app');
const lib = ref('lib');
const row = (slug: string, level: Level): Row => ({ slug, level });
const group = (sources: { project: ProjectRef; entries: Row[] | null }[]) =>
  groupRows(sources, (entry) => entry.slug);

describe('groupRows', () => {
  it('marks a shared entry of every project as everywhere', () => {
    const rows = group([
      { project: app, entries: [row('coder', 'global')] },
      { project: lib, entries: [row('coder', 'global')] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: 'coder', shared: true, everywhere: true });
    expect(rows[0]!.presences.map((p) => p.project.slug)).toEqual(['app', 'lib']);
  });

  it('puts one slug of two projects on one row with two presences', () => {
    const rows = group([
      { project: app, entries: [row('tester', 'project')] },
      { project: lib, entries: [row('tester', 'project')] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.presences).toHaveLength(2);
    expect(rows[0]).toMatchObject({ shared: false, everywhere: false });
  });

  it('is not everywhere when a project overrides the shared entry', () => {
    const rows = group([
      { project: app, entries: [row('coder', 'project_over_global')] },
      { project: lib, entries: [row('coder', 'global')] },
    ]);
    expect(rows[0]).toMatchObject({ shared: true, everywhere: false, level: 'global' });
  });

  it('ignores a project without a configuration for everywhere', () => {
    const rows = group([
      { project: app, entries: [row('coder', 'global')] },
      { project: lib, entries: null },
    ]);
    expect(rows[0]!.everywhere).toBe(true);
  });

  it('keeps the order of the first appearance', () => {
    const rows = group([
      { project: app, entries: [row('b', 'project'), row('a', 'project')] },
      { project: lib, entries: [row('c', 'project'), row('b', 'project')] },
    ]);
    expect(rows.map((r) => r.slug)).toEqual(['b', 'a', 'c']);
  });
});

describe('the filter «Project» over groups', () => {
  const rows = group([
    { project: app, entries: [row('coder', 'global'), row('tester', 'project')] },
    { project: lib, entries: [row('coder', 'global'), row('docs', 'project')] },
  ]);

  it('offers the shared choice and the projects of the groups', () => {
    expect(projectOptions(rows).map((o) => o.value)).toEqual([SHARED_PROJECT, 'app', 'lib']);
  });

  it('offers nothing for rows without presences', () => {
    expect(projectOptions([{ slug: 'x' }])).toEqual([]);
    expect(inProjects({ slug: 'x' }, ['app'])).toBe(true);
  });

  it('keeps a row that has any chosen project', () => {
    const shown = (chosen: string[]) =>
      rows.filter((r) => inProjects(r, chosen)).map((r) => r.slug);
    expect(shown(['lib'])).toEqual(['coder', 'docs']);
    expect(shown([SHARED_PROJECT])).toEqual(['coder']);
    expect(shown([])).toEqual(['coder', 'tester', 'docs']);
  });

  it('counts rows, not entries', () => {
    const counts = projectCounts(rows);
    expect(counts.get('app')).toBe(2);
    expect(counts.get('lib')).toBe(2);
    expect(counts.get(SHARED_PROJECT)).toBe(1);
  });
});
