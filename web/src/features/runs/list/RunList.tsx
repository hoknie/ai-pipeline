import { SearchX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useNearEnd } from '../../../shared/lib/browser/useNearEnd.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { useTags } from '../../../shared/lib/catalog/tags.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import { ListTail } from './ListTail.tsx';
import { RunCard } from './RunCard.tsx';
import { RunFilters } from './RunFilters.tsx';

import {
  activeFilters,
  EMPTY_FILTERS,
  filterRuns,
  type RunFilterState,
  type RunScope,
} from './runFilter.ts';

function ListEmpty({
  done,
  filtered,
  onReset,
}: {
  done: boolean;
  filtered: boolean;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {done ? <Empty icon={<SearchX />} title={t('runs.list.empty')} /> : null}
      {filtered ? (
        <Button variant="outline" size="sm" onClick={onReset}>
          {t('runs.list.reset')}
        </Button>
      ) : null}
    </>
  );
}

export function RunList({
  runs,
  selectedRun,
  selectedGroup,
  now,
  query,
  onQuery,
  filters: filterState,
  onFilters,
  onSelect,
  scope,
  onScope,
  repository,
  repositoryPaths,
  showFilters = true,
  more = 'done',
  onMore = () => undefined,
}: {
  runs: RunView[];
  selectedRun: string | null;
  selectedGroup: string | null;
  now: number;
  query: string;
  onQuery: (query: string) => void;
  filters: RunFilterState;
  onFilters: (filters: RunFilterState) => void;
  onSelect: (runId: string, group: string | null) => void;
  /** Whose runs the list shows: those of the selected repository or of every one. */
  scope: RunScope;
  onScope: (scope: RunScope) => void;
  /** The selected repository; null until known. */
  repository: string | null;
  /** The path of each repository as shown; absent: the path itself. */
  repositoryPaths?: ReadonlyMap<string, string>;
  /** Whether the filters stand above the list; false when the page shows them elsewhere. */
  showFilters?: boolean;
  /** Older finished runs: more to load (`idle`), loading, failed, or none left (`done`). */
  more?: 'idle' | 'loading' | 'error' | 'done';
  /** Loads the next page of older runs; also the retry after an error. */
  onMore?: () => void;
}) {
  const { t } = useTranslation();
  const { byId } = useTags();
  const shown = filterRuns(runs, query, filterState, scope, repository, byId);
  const filtered = activeFilters(query, filterState, scope) > 0;
  const [marker, setMarker] = useState<HTMLElement | null>(null);
  useNearEnd(more === 'idle' ? marker : null, onMore, runs.length);
  return (
    <div className="flex flex-col gap-2">
      {showFilters ? (
        <RunFilters
          {...{ runs, query, onQuery, scope, onScope, repository, repositoryPaths }}
          filters={filterState}
          onFilters={onFilters}
        />
      ) : null}
      {shown.length === 0 ? (
        <ListEmpty
          done={more === 'done'}
          filtered={filtered}
          onReset={() => {
            onQuery('');
            onFilters(EMPTY_FILTERS);
          }}
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              open={run.id === selectedRun}
              selectedGroup={selectedGroup}
              now={now}
              scope={scope}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
      <ListTail more={more} onMore={onMore} setMarker={setMarker} />
    </div>
  );
}
