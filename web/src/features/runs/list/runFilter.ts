import { isRepairing, type PanelRunState } from '../../../shared/api/observerTypes.ts';
import { runTitle, taskNumber } from '../../../shared/lib/format.ts';
import type { RunView, TagView } from '../../../shared/api/types.ts';

/** Whose runs the list shows: those of the selected repository or of every repository. */
export type RunScope = 'repository' | 'all';

/** The nine states a run can be in, in the order of the state filter. */
export const RUN_STATES: PanelRunState[] = [
  'needs_human',
  'active',
  'repair',
  'queued',
  'paused',
  'frozen',
  'finished',
  'failed',
  'cancelled',
];

/** Choices of the run filters; every list is empty when the filter is off. */
export interface RunFilterState {
  states: PanelRunState[];
  /** Pipeline slugs. */
  pipelines: string[];
  /** Specialist slugs. */
  specialists: string[];
  tagIds: string[];
  /** Repository paths; applies only to the runs of every repository. */
  repositories: string[];
}

export const EMPTY_FILTERS: RunFilterState = {
  states: [],
  pipelines: [],
  specialists: [],
  tagIds: [],
  repositories: [],
};

/** A filter of the state; `key` names its list. */
export type RunFilterKey = keyof RunFilterState;

const FILTER_KEYS: RunFilterKey[] = [
  'states',
  'pipelines',
  'specialists',
  'tagIds',
  'repositories',
];

/** Specialists of the steps the run does not skip, plus the one of the split. */
export function runSpecialists(run: RunView): string[] {
  const slugs = (run.steps ?? []).filter((step) => !step.skipped).map((step) => step.specialist);
  const split = run.topology?.split?.specialist;
  return [...new Set(split ? [...slugs, split] : slugs)];
}

/**
 * Whether the run has at least one of the tags; no chosen tags means every run. The tags come
 * from the catalog of one repository: a run of another repository (the list of every repository)
 * matches the tag of the same name, ignoring case.
 */
export function inTags(
  run: RunView,
  tagIds: readonly string[],
  catalog: ReadonlyMap<string, TagView> = new Map(),
): boolean {
  if (tagIds.length === 0) return true;
  const names = tagIds.flatMap((id) => catalog.get(id)?.name.toLowerCase() ?? []);
  return (run.tags ?? []).some(
    (tag) => tagIds.includes(tag.id) || names.includes(tag.name.toLowerCase()),
  );
}

/** Searched text of a run: title, name, pipeline, id, group titles, tag names, specialists. */
function haystack(run: RunView, catalog: ReadonlyMap<string, TagView>): string {
  const tagNames = (run.tags ?? []).flatMap((tag) => catalog.get(tag.id)?.name ?? []);
  return [
    runTitle(run),
    run.name,
    run.pipeline,
    run.pipelineName,
    run.id,
    taskNumber(run.number),
    ...run.groups.map((group) => group.title),
    ...tagNames,
    ...runSpecialists(run),
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .toLowerCase();
}

/** Runs of one repository; `null` keeps the runs of every repository. */
export function runsOf(runs: RunView[], repository: string | null): RunView[] {
  return repository === null ? runs : runs.filter((run) => run.repository === repository);
}

function matchesQuery(run: RunView, query: string, catalog: ReadonlyMap<string, TagView>) {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  // `#7` is the number of a task and matches it exactly (not 17 or 70).
  const numeric = /^#(\d+)$/.exec(needle);
  return numeric ? run.number === Number(numeric[1]) : haystack(run, catalog).includes(needle);
}

/** Whether the run passes the filter `key` of the state; the repository one needs the scope «all». */
function passes(
  run: RunView,
  key: RunFilterKey,
  state: RunFilterState,
  scope: RunScope,
  catalog: ReadonlyMap<string, TagView>,
): boolean {
  switch (key) {
    case 'states':
      return state.states.length === 0 || state.states.includes(run.state);
    case 'pipelines':
      return state.pipelines.length === 0 || state.pipelines.includes(run.pipeline);
    case 'specialists':
      return (
        state.specialists.length === 0 ||
        runSpecialists(run).some((slug) => state.specialists.includes(slug))
      );
    case 'tagIds':
      return inTags(run, state.tagIds, catalog);
    case 'repositories':
      return (
        scope !== 'all' ||
        state.repositories.length === 0 ||
        state.repositories.includes(run.repository)
      );
  }
}

/**
 * Runs matching the query (case-insensitive) and every filter (any of the choices inside one
 * filter, all the filters together), in their own order; with a repository, only its runs
 * (`null` means all repositories).
 */
export function filterRuns(
  runs: RunView[],
  query: string,
  state: RunFilterState,
  scope: RunScope,
  repository: string | null = null,
  catalog: ReadonlyMap<string, TagView> = new Map(),
): RunView[] {
  return runsOf(runs, scope === 'repository' ? repository : null).filter(
    (run) =>
      matchesQuery(run, query, catalog) &&
      FILTER_KEYS.every((key) => passes(run, key, state, scope, catalog)),
  );
}

/**
 * Runs for the counters of the filter `key`: those passing the query and every other filter, so
 * a counter says how many runs the choice would show.
 */
export function facetRuns(
  runs: RunView[],
  query: string,
  state: RunFilterState,
  scope: RunScope,
  repository: string | null,
  catalog: ReadonlyMap<string, TagView>,
  key: RunFilterKey,
): RunView[] {
  return runsOf(runs, scope === 'repository' ? repository : null).filter(
    (run) =>
      matchesQuery(run, query, catalog) &&
      FILTER_KEYS.every((other) => other === key || passes(run, other, state, scope, catalog)),
  );
}

/** How many runs each value of the filter `key` would show, by value. */
export function optionCounts(
  runs: RunView[],
  query: string,
  state: RunFilterState,
  scope: RunScope,
  repository: string | null,
  catalog: ReadonlyMap<string, TagView>,
  key: RunFilterKey,
): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (value: string) => counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const run of facetRuns(runs, query, state, scope, repository, catalog, key)) {
    switch (key) {
      case 'states':
        add(run.state);
        break;
      case 'pipelines':
        add(run.pipeline);
        break;
      case 'specialists':
        runSpecialists(run).forEach(add);
        break;
      case 'repositories':
        add(run.repository);
        break;
      case 'tagIds': {
        // a run counts for each tag of the catalog it carries, also by the name (other repository)
        for (const id of catalog.keys())
          if ((run.tags ?? []).length > 0 && inTags(run, [id], catalog)) add(id);
        break;
      }
    }
  }
  return counts;
}

/** Navigation counters: unfinished runs and those among them waiting for an answer. */
export function navRunCounts(runs: RunView[]): { working: number; waiting: number } {
  const waiting = runs.filter((run) => run.state === 'needs_human').length;
  const active = runs.filter((run) => run.state === 'active' || isRepairing(run)).length;
  return { working: active + waiting, waiting };
}

/** How many filters are in effect: a non-empty search and every chosen value. */
export function activeFilters(query: string, state: RunFilterState, scope: RunScope): number {
  // the repository choice only applies in the «all repositories» scope
  return (
    (query.trim() !== '' ? 1 : 0) +
    FILTER_KEYS.reduce(
      (sum, key) => sum + (key === 'repositories' && scope !== 'all' ? 0 : state[key].length),
      0,
    )
  );
}
