import type { Queue } from '../../../feature/queue/types/index.ts';
import { type RunState, isRunFinished, runPhase } from '../../../feature/runs/types/index.ts';
import type { RepositoryEntry, RepositoryView } from '../contract/responses/repositories.ts';

/** The path with the home directory (itself or as a prefix before a separator) written as `~`. */
export function displayPath(path: string, home: string | null): string {
  if (home === null || home === '') return path;
  const base = home.length > 1 ? home.replace(/\/+$/, '') : home;
  if (path === base) return '~';
  return path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
}

/** Registry entries with their counters, sorted by path. */
export function repositoryViews(
  entries: readonly RepositoryEntry[],
  runs: readonly RunState[],
  queues: readonly Queue[],
  home: string | null = null,
): RepositoryView[] {
  return entries
    .map((entry) => {
      const own = runs.filter((state) => state.run.repository === entry.path);
      const queue = queues.find((candidate) => candidate.repository === entry.path);
      return {
        path: entry.path,
        displayPath: displayPath(entry.path, home),
        addedAt: entry.addedAt,
        unfinished: own.filter((state) => !isRunFinished(state)).length,
        waiting: own.filter((state) => runPhase(state) === 'needs_human').length,
        queued: queue?.items.length ?? 0,
      };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}
