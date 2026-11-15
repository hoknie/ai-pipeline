import type { RepositoryView } from '../../api/types.ts';

/** A project as a list row names it: the dot, the name and where its data is read and written. */
export interface ProjectRef {
  path: string;
  slug: string;
  label: string;
  color: string | null;
}

/** A row of a list that merges the configuration of several projects. */
export type InProject<T> = T & {
  /** The project of a project row; null for a shared (global) one. */
  project: ProjectRef | null;
  /** The project whose configuration supplied the row: the form reads and saves through it. */
  from: ProjectRef;
};

/** Value of the filter «Project» that stands for the shared entries. */
export const SHARED_PROJECT = '*shared';

export function projectRef(
  entry: Pick<RepositoryView, 'path' | 'slug' | 'label' | 'color'>,
): ProjectRef {
  return { path: entry.path, slug: entry.slug, label: entry.label, color: entry.color };
}

/** The enabled projects in the order of their names without regard to case, then paths. */
export function enabledProjects(registry: readonly RepositoryView[]): ProjectRef[] {
  return registry
    .filter((entry) => entry.enabled)
    .map(projectRef)
    .sort((left, right) => {
      const names = left.label.toLowerCase().localeCompare(right.label.toLowerCase());
      return names !== 0 ? names : left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    });
}

/** The key of a row: the id of a shared entry, `<project slug>/<id>` for a project one. */
export const rowKey = (project: string | null | undefined, id: string): string =>
  project ? `${project}/${id}` : id;

/** The project slug and the id of a row key. */
export function splitRowKey(key: string): { project: string | null; id: string } {
  const at = key.indexOf('/');
  return at === -1
    ? { project: null, id: key }
    : { project: key.slice(0, at), id: key.slice(at + 1) };
}

export interface ProjectEntries<T> {
  project: ProjectRef;
  entries: readonly T[] | null;
}

/**
 * The shared entries once (from the first project that has them) and the entries of each
 * project, on their own rows; `level` tells which is which.
 */
export function mergeRows<T extends { level: 'project' | 'global' | 'project_over_global' }>(
  sources: readonly ProjectEntries<T>[],
  idOf: (entry: T) => string,
): InProject<T>[] {
  const seen = new Set<string>();
  const shared: InProject<T>[] = [];
  const own: InProject<T>[] = [];
  for (const { project, entries } of sources) {
    for (const entry of entries ?? []) {
      if (entry.level === 'global') {
        if (seen.has(idOf(entry))) continue;
        seen.add(idOf(entry));
        shared.push({ ...entry, project: null, from: project });
      } else {
        own.push({ ...entry, project, from: project });
      }
    }
  }
  return [...shared, ...own];
}

/** A choice of the filter «Project»: the value, and the name of a project (null: «Shared»). */
export interface ProjectOption {
  value: string;
  label: string | null;
}

type Projected = object;
const projectOf = (row: Projected): ProjectRef | null | undefined =>
  (row as { project?: ProjectRef | null }).project;

/** The choices of the filter «Project»; none outside the mode «All projects», where rows have no project. */
export function projectOptions(rows: readonly Projected[]): ProjectOption[] {
  if (rows.every((row) => projectOf(row) === undefined)) return [];
  const options: ProjectOption[] = [];
  if (rows.some((row) => projectOf(row) === null))
    options.push({ value: SHARED_PROJECT, label: null });
  const named = new Map<string, ProjectRef>();
  for (const row of rows) {
    const project = projectOf(row);
    if (project) named.set(project.slug, project);
  }
  return [
    ...options,
    ...[...named.values()]
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
      .map((project) => ({ value: project.slug, label: project.label })),
  ];
}

/** Whether the row is of one of the chosen projects (any when none is chosen). */
export function inProjects(row: Projected, chosen: readonly string[]): boolean {
  const project = projectOf(row);
  if (chosen.length === 0 || project === undefined) return true;
  return chosen.includes(project === null ? SHARED_PROJECT : project.slug);
}

/** How many rows each choice of the filter «Project» shows. */
export function projectCounts(rows: readonly Projected[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const project = projectOf(row);
    if (project === undefined) continue;
    const value = project === null ? SHARED_PROJECT : project.slug;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
