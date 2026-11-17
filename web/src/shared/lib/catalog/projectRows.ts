import type { EntryLevel, RepositoryView } from '../../api/types.ts';

/** A project as a list row names it: the dot, the name and where its data is read and written. */
export interface ProjectRef {
  path: string;
  slug: string;
  label: string;
  color: string | null;
}

/** An entry as the final configuration of a project has it. */
export interface Presence<T> {
  project: ProjectRef;
  entry: T;
}

/**
 * A row of a list that groups the entries of several projects by their id: the fields are those
 * of the shared entry (else of the first project that has the entry).
 */
export type Grouped<T> = T & {
  /** A shared file has the entry (in at least one project). */
  shared: boolean;
  /** The projects whose configuration has the entry, in the order of the projects. */
  presences: Presence<T>[];
  /** The shared entry is in every readable project and no project overrides it. */
  everywhere: boolean;
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

export interface ProjectEntries<T> {
  project: ProjectRef;
  entries: readonly T[] | null;
}

/** The entries of all projects, one row per id with the projects that have it under it. */
export function groupRows<T extends { level: EntryLevel }>(
  sources: readonly ProjectEntries<T>[],
  idOf: (entry: T) => string,
): Grouped<T>[] {
  const readable = sources.filter((source) => source.entries !== null).length;
  const groups = new Map<string, Presence<T>[]>();
  for (const { project, entries } of sources) {
    for (const entry of entries ?? []) {
      const list = groups.get(idOf(entry)) ?? [];
      list.push({ project, entry });
      groups.set(idOf(entry), list);
    }
  }
  return [...groups.values()].map((presences) => {
    const lead = presences.find((p) => p.entry.level === 'global') ?? presences[0]!;
    return {
      ...lead.entry,
      shared: presences.some((p) => p.entry.level !== 'project'),
      presences,
      everywhere:
        presences.length === readable && presences.every((p) => p.entry.level === 'global'),
    };
  });
}

/** What a row of a list carries in the mode «All projects»; a row outside it has none. */
export interface GroupInfo {
  shared?: boolean;
  presences?: readonly Presence<{ level: EntryLevel }>[];
  everywhere?: boolean;
}

/** A choice of the filter «Project»: the value, and the name of a project (null: «Shared»). */
export interface ProjectOption {
  value: string;
  label: string | null;
}

type Projected = object;
const presencesOf = (row: Projected): readonly Presence<unknown>[] | undefined =>
  (row as { presences?: Presence<unknown>[] }).presences;
const isShared = (row: Projected): boolean => (row as { shared?: boolean }).shared === true;

/** The choices of the filter «Project»; none outside the mode «All projects», where rows have no presences. */
export function projectOptions(rows: readonly Projected[]): ProjectOption[] {
  if (rows.every((row) => presencesOf(row) === undefined)) return [];
  const options: ProjectOption[] = [];
  if (rows.some(isShared)) options.push({ value: SHARED_PROJECT, label: null });
  const named = new Map<string, ProjectRef>();
  for (const row of rows) {
    for (const { project } of presencesOf(row) ?? []) named.set(project.slug, project);
  }
  return [
    ...options,
    ...[...named.values()]
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
      .map((project) => ({ value: project.slug, label: project.label })),
  ];
}

/** Whether the row is in one of the chosen projects (any when none is chosen). */
export function inProjects(row: Projected, chosen: readonly string[]): boolean {
  const presences = presencesOf(row);
  if (chosen.length === 0 || presences === undefined) return true;
  return chosen.some((value) =>
    value === SHARED_PROJECT ? isShared(row) : presences.some((p) => p.project.slug === value),
  );
}

/** How many rows each choice of the filter «Project» shows. */
export function projectCounts(rows: readonly Projected[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const presences = presencesOf(row);
    if (presences === undefined) continue;
    const values = new Set(presences.map((p) => p.project.slug));
    if (isShared(row)) values.add(SHARED_PROJECT);
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
