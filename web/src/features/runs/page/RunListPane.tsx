import { useTranslation } from 'react-i18next';

import type { HistoryState } from '../../../shared/api/runs/runsState.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { RunList } from '../list/RunList.tsx';
import type { RunFilterState, RunScope } from '../list/runFilter.ts';

/** Whether older finished runs are left to load, loading, failed, or there are none. */
function moreOf(history: HistoryState | undefined): 'idle' | 'loading' | 'error' | 'done' {
  if (!history || history.done) return 'done';
  return history.error !== null ? 'error' : history.loading ? 'loading' : 'idle';
}

export interface ListPaneProps {
  runs: RunView[];
  loaded: boolean;
  run: RunView | null;
  group: string | null;
  now: number;
  query: string;
  onQuery: (query: string) => void;
  filters: RunFilterState;
  onFilters: (filters: RunFilterState) => void;
  onSelect: (runId: string, group: string | null) => void;
  scope: RunScope;
  onScope: (scope: RunScope) => void;
  repository: string | null;
  repositoryPaths?: ReadonlyMap<string, string>;
  history?: HistoryState;
}

/** The list of runs, or the placeholders of a connection that is not up yet. */
export function RunListPane(props: ListPaneProps) {
  const { t } = useTranslation();
  const { runs, loaded, run, group, history, ...rest } = props;
  if (!loaded) {
    return (
      <div role="status" aria-label={t('runs.page.connecting')} className="flex flex-col gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (runs.length === 0) return null;
  return (
    <RunList
      showFilters={false}
      runs={runs}
      selectedRun={run?.id ?? null}
      selectedGroup={group}
      now={rest.now}
      query={rest.query}
      onQuery={rest.onQuery}
      filters={rest.filters}
      onFilters={rest.onFilters}
      onSelect={rest.onSelect}
      scope={rest.scope}
      onScope={rest.onScope}
      repository={rest.repository}
      repositoryPaths={rest.repositoryPaths}
      more={moreOf(history)}
      onMore={history?.loadMore}
    />
  );
}
