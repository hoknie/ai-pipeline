import type { RepositoryView } from './types.ts';

/** The directory name of a repository path, the label shown in the panel. */
export function repositoryLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
  return name || path;
}

/** Repositories the panel can switch between: the home one first, then the registry by name. */
export function repositoryList(home: string | null, registry: readonly RepositoryView[]): string[] {
  const others = new Set(registry.map((entry) => entry.path));
  if (home !== null) others.delete(home);
  const sorted = [...others].sort(
    (left, right) =>
      repositoryLabel(left).localeCompare(repositoryLabel(right)) || left.localeCompare(right),
  );
  return home === null ? sorted : [home, ...sorted];
}

/** How many runs of each repository wait for an answer. */
export function waitingByRepository(registry: readonly RepositoryView[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of registry) if (entry.waiting > 0) counts.set(entry.path, entry.waiting);
  return counts;
}
