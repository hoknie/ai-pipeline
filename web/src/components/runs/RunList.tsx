import { SearchX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cost, diffText, runTimes, runTitle, taskNumber, usageText } from '../../format.ts';
import { useLocale } from '../../i18n/index.ts';
import { cn } from '../../lib/cn.ts';
import { repositoryLabel } from '../../repositories.ts';
import { runStatusLabel } from '../../status.ts';
import { useNearEnd } from '../../useNearEnd.ts';
import type { RunView } from '../../types.ts';
import { useTags } from '../../tags.tsx';
import { Button } from '../../ui/button.tsx';
import { Empty } from '../../ui/empty.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';
import { orderEntries } from '../order.ts';
import { StatusBadge } from '../StatusBadge.tsx';
import { entryBadge } from './RunStatuses.tsx';
import { TagChips } from '../TagChip.tsx';
import { WorkflowBadge } from '../WorkflowBadge.tsx';
import { RunDecisions } from './RunDecisions.tsx';
import { RunFilters } from './RunFilters.tsx';
import { RunProgress } from './RunProgress.tsx';
import { RunWarningsBadge } from './RunWarningsBadge.tsx';

import {
  activeFilters,
  EMPTY_FILTERS,
  filterRuns,
  type RunFilterState,
  type RunScope,
} from './runFilter.ts';

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
  const locale = useLocale();
  const { byId } = useTags();
  const shown = filterRuns(runs, query, filterState, scope, repository, byId);
  const filtered = activeFilters(query, filterState, scope) > 0;
  const [marker, setMarker] = useState<HTMLElement | null>(null);
  useNearEnd(more === 'idle' ? marker : null, onMore, runs.length);
  const tail =
    more === 'done' ? null : more === 'error' ? (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
        {t('runs.list.moreFailed')}
        <Button variant="outline" size="sm" onClick={onMore}>
          {t('runs.list.retry')}
        </Button>
      </div>
    ) : (
      <div
        ref={setMarker}
        role={more === 'loading' ? 'status' : undefined}
        aria-label={more === 'loading' ? t('runs.list.loadingMore') : undefined}
        data-run-list-end=""
        className="flex flex-col gap-2"
      >
        {more === 'loading' ? <Skeleton className="h-16" /> : <div className="h-4" />}
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      {showFilters ? (
        <RunFilters
          runs={runs}
          query={query}
          onQuery={onQuery}
          filters={filterState}
          onFilters={onFilters}
          scope={scope}
          onScope={onScope}
          repository={repository}
          repositoryPaths={repositoryPaths}
        />
      ) : null}
      {shown.length === 0 ? (
        <>
          {more === 'done' ? <Empty icon={<SearchX />} title={t('runs.list.empty')} /> : null}
          {filtered ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onQuery('');
                onFilters(EMPTY_FILTERS);
              }}
            >
              {t('runs.list.reset')}
            </Button>
          ) : null}
        </>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((run) => {
            const open = run.id === selectedRun;
            const groups = orderEntries(run);
            const times = runTimes(run, now, locale);
            return (
              <li key={run.id} data-run={run.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full flex-col gap-1 rounded-lg border bg-card p-2.5 text-left hover:bg-accent',
                    open && 'border-primary bg-accent',
                  )}
                  aria-expanded={open}
                  title={`${runTitle(run)}\n${run.id}`}
                  onClick={() => onSelect(run.id, null)}
                >
                  <span className="block min-w-0 text-sm font-medium break-words [overflow-wrap:anywhere]">
                    <span className="font-mono text-xs text-muted-foreground">
                      {taskNumber(run.number)}
                    </span>{' '}
                    {runTitle(run)}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {run.name ?? '—'}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {scope === 'all' ? (
                      <span className="font-medium" title={run.repository}>
                        {repositoryLabel(run.repository)}
                      </span>
                    ) : null}
                    <WorkflowBadge id={run.workflow} name={run.workflowName} focusable={false} />
                    <TagChips tags={run.tags ?? []} nested />
                  </span>
                  <span className="grid grid-cols-2 items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusBadge status={run.state} label={runStatusLabel(run, t)} />
                      <RunWarningsBadge run={run} />
                    </span>
                    {run.state === 'finished' ? null : (
                      <RunProgress done={run.progress.done} total={run.progress.total} />
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{times.created}</span>
                    <span>{times.duration}</span>
                    {usageText(run.usage) ? <span>{usageText(run.usage)}</span> : null}
                    {cost(run.usage) ? <span>{cost(run.usage)}</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {run.liveDiff ? diffText(run.liveDiff, t) : '—'}
                  </span>
                  <RunDecisions run={run} />
                </button>
                {open && groups.length > 1 ? (
                  <ul
                    aria-label={t('runs.list.groups')}
                    className="mt-1 ml-3 flex flex-col gap-0.5 border-l pl-2"
                  >
                    {groups.map((group) => (
                      <li key={group.slug}>
                        <button
                          type="button"
                          aria-current={group.slug === selectedGroup}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent',
                            group.slug === selectedGroup && 'bg-accent font-medium',
                          )}
                          onClick={() => onSelect(run.id, group.slug)}
                        >
                          <span className="truncate" title={group.title}>
                            {'kind' in group ? t(`runs.system.${group.kind}`) : group.title}
                            {'kind' in group ? (
                              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                {t('runs.system.badge')}
                              </span>
                            ) : null}
                          </span>
                          {entryBadge(group, t)}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {tail}
    </div>
  );
}
