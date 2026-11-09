import type { RepositoryView } from '../../api/types.ts';

/** The projects of the registry by path, as the panel last received them. */
let projects = new Map<string, RepositoryView>();

/**
 * Remembers the registry, so that every place naming a project shows its name and color. The
 * panel calls it whenever the list changes; the views re-render with the list.
 */
export function rememberProjects(registry: readonly RepositoryView[]): void {
  projects = new Map(registry.map((entry) => [entry.path, entry]));
}

/** The directory name of a repository path. */
export function directoryLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
  return name || path;
}

/** The label shown in the panel: the project's own name, or the directory name. */
export function repositoryLabel(path: string): string {
  return projects.get(path)?.label ?? directoryLabel(path);
}

/** The color of a project; null without one or for a path outside the registry. */
export function repositoryColor(path: string): string | null {
  return projects.get(path)?.color ?? null;
}

const enabledOf = (entry: RepositoryView) => entry.enabled !== false;

const byLabel = (left: string, right: string) =>
  repositoryLabel(left).localeCompare(repositoryLabel(right), undefined, {
    sensitivity: 'base',
  }) || left.localeCompare(right);

/**
 * Repositories the panel can switch between: the home one first, then the enabled projects of
 * the registry by label. Disabled projects are not offered.
 */
export function repositoryList(home: string | null, registry: readonly RepositoryView[]): string[] {
  const disabled = new Set(
    registry.filter((entry) => !enabledOf(entry)).map((entry) => entry.path),
  );
  const others = new Set(registry.filter(enabledOf).map((entry) => entry.path));
  const first = home !== null && !disabled.has(home) ? home : null;
  if (first !== null) others.delete(first);
  const sorted = [...others].sort(byLabel);
  return first === null ? sorted : [first, ...sorted];
}

/** The enabled project added last: the default when the home one is gone or disabled. */
export function latestEnabled(registry: readonly RepositoryView[]): string | null {
  let latest: RepositoryView | null = null;
  for (const entry of registry) {
    if (enabledOf(entry) && (latest === null || entry.addedAt >= latest.addedAt)) latest = entry;
  }
  return latest?.path ?? null;
}

/** How many runs of each repository wait for an answer. */
export function waitingByRepository(registry: readonly RepositoryView[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of registry) if (entry.waiting > 0) counts.set(entry.path, entry.waiting);
  return counts;
}

/** The path of each registered repository as it is shown (the home directory written as `~`). */
export function displayPaths(registry: readonly RepositoryView[]): Map<string, string> {
  return new Map(registry.map((entry) => [entry.path, entry.displayPath ?? entry.path]));
}

/** Whether the label, the slug or the path of a repository contains the query, ignoring case. */
export function repositoryMatches(path: string, shown: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [
    repositoryLabel(path),
    directoryLabel(path),
    projects.get(path)?.slug ?? '',
    path,
    shown,
  ].some((text) => text.toLowerCase().includes(needle));
}

/**
 * The project a typed path (absolute or `~/…`) added: the entry whose root holds the path, else
 * the one not known before. The daemon answers an addition with the whole list only.
 */
export function addedProject(
  path: string,
  before: readonly RepositoryView[],
  after: readonly RepositoryView[],
): RepositoryView | undefined {
  const known = new Set(before.map((entry) => entry.path));
  const holds = (root: string) => path === root || path.startsWith(`${root}/`);
  return (
    after
      .filter((entry) => holds(entry.path) || holds(entry.displayPath))
      .sort((left, right) => right.path.length - left.path.length)[0] ??
    after.find((entry) => !known.has(entry.path))
  );
}
