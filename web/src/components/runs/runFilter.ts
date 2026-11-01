import { runTitle } from '../../format.ts';
import type { RunView } from '../../types.ts';

/** Whose runs the list shows: those of the selected repository or of every repository. */
export type RunScope = 'repository' | 'all';

export type RunFilter = 'all' | 'waiting' | 'active' | 'done';

/** Filters of the run list; labels are keys under `runs.list` in the dictionaries. */
export const RUN_FILTERS: { value: RunFilter; labelKey: RunFilter }[] = [
  { value: 'all', labelKey: 'all' },
  { value: 'waiting', labelKey: 'waiting' },
  { value: 'active', labelKey: 'active' },
  { value: 'done', labelKey: 'done' },
];

function inFilter(run: RunView, filter: RunFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'waiting':
      return run.state === 'needs_human';
    case 'active':
      return !run.finished && run.state !== 'needs_human';
    case 'done':
      return run.finished || run.state === 'cancelled';
  }
}

/** Searched text of a run: title, name, workflow, id, group titles. */
function haystack(run: RunView): string {
  return [runTitle(run), run.name, run.workflow, run.id, ...run.groups.map((group) => group.title)]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .toLowerCase();
}

/** Runs of one repository; `null` keeps the runs of every repository. */
export function runsOf(runs: RunView[], repository: string | null): RunView[] {
  return repository === null ? runs : runs.filter((run) => run.repository === repository);
}

/**
 * Runs matching the query (case-insensitive) and the filter, in their own order; with a
 * repository, only its runs (`null` means all repositories).
 */
export function filterRuns(
  runs: RunView[],
  query: string,
  filter: RunFilter,
  repository: string | null = null,
): RunView[] {
  const needle = query.trim().toLowerCase();
  return runsOf(runs, repository).filter(
    (run) => inFilter(run, filter) && (needle === '' || haystack(run).includes(needle)),
  );
}

/** Navigation counters: unfinished runs and those among them waiting for an answer. */
export function navRunCounts(runs: RunView[]): { working: number; waiting: number } {
  const waiting = runs.filter((run) => run.state === 'needs_human').length;
  const active = runs.filter((run) => run.state === 'active').length;
  return { working: active + waiting, waiting };
}

export function filterCounts(runs: RunView[]): Record<RunFilter, number> {
  return {
    all: runs.length,
    waiting: runs.filter((run) => inFilter(run, 'waiting')).length,
    active: runs.filter((run) => inFilter(run, 'active')).length,
    done: runs.filter((run) => inFilter(run, 'done')).length,
  };
}
