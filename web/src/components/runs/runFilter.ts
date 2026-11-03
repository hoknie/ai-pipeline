import { runTitle, taskNumber } from '../../format.ts';
import type { RunView, TagView } from '../../types.ts';

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
      return run.state === 'queued' || (!run.finished && run.state !== 'needs_human');
    case 'done':
      return run.state !== 'queued' && (run.finished || run.state === 'cancelled');
  }
}

/** Whether the run has at least one of the tags; no chosen tags means every run. */
export function inTags(run: RunView, tagIds: readonly string[]): boolean {
  if (tagIds.length === 0) return true;
  return (run.tags ?? []).some((tag) => tagIds.includes(tag.id));
}

/** Searched text of a run: title, name, workflow, id, group titles, tag names. */
function haystack(run: RunView, catalog: ReadonlyMap<string, TagView>): string {
  const tagNames = (run.tags ?? []).flatMap((tag) => catalog.get(tag.id)?.name ?? []);
  return [
    runTitle(run),
    run.name,
    run.workflow,
    run.id,
    taskNumber(run.number),
    ...run.groups.map((group) => group.title),
    ...tagNames,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .toLowerCase();
}

/** Runs of one repository; `null` keeps the runs of every repository. */
export function runsOf(runs: RunView[], repository: string | null): RunView[] {
  return repository === null ? runs : runs.filter((run) => run.repository === repository);
}

/**
 * Runs matching the query (case-insensitive), the status filter and the tags (any of them), in
 * their own order; with a repository, only its runs (`null` means all repositories).
 */
export function filterRuns(
  runs: RunView[],
  query: string,
  filter: RunFilter,
  repository: string | null = null,
  tagIds: readonly string[] = [],
  catalog: ReadonlyMap<string, TagView> = new Map(),
): RunView[] {
  const needle = query.trim().toLowerCase();
  // `#7` is the number of a task and matches it exactly (not 17 or 70).
  const numeric = /^#(\d+)$/.exec(needle);
  const matches = (run: RunView): boolean =>
    numeric ? run.number === Number(numeric[1]) : haystack(run, catalog).includes(needle);
  return runsOf(runs, repository).filter(
    (run) => inFilter(run, filter) && inTags(run, tagIds) && (needle === '' || matches(run)),
  );
}

/** Navigation counters: unfinished runs and those among them waiting for an answer. */
export function navRunCounts(runs: RunView[]): { working: number; waiting: number } {
  const waiting = runs.filter((run) => run.state === 'needs_human').length;
  const active = runs.filter((run) => run.state === 'active').length;
  return { working: active + waiting, waiting };
}

/** Counters of the status filter over the runs that have one of the tags. */
export function filterCounts(
  all: RunView[],
  tagIds: readonly string[] = [],
): Record<RunFilter, number> {
  const runs = all.filter((run) => inTags(run, tagIds));
  return {
    all: runs.length,
    waiting: runs.filter((run) => inFilter(run, 'waiting')).length,
    active: runs.filter((run) => inFilter(run, 'active')).length,
    done: runs.filter((run) => inFilter(run, 'done')).length,
  };
}

/** How many filters are in effect: a non-empty search, a status other than «all», chosen tags. */
export function activeFilters(query: string, filter: RunFilter, tagIds: readonly string[]): number {
  return (query.trim() !== '' ? 1 : 0) + (filter !== 'all' ? 1 : 0) + tagIds.length;
}
