import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cost, diffText, runTime, runTitle, taskNumber, usageText } from '../../format.ts';
import { useLocale } from '../../i18n/index.ts';
import { cn } from '../../lib/cn.ts';
import { repositoryLabel } from '../../repositories.ts';
import { runStatusLabel } from '../../status.ts';
import type { RunView } from '../../types.ts';
import { useTags } from '../../tags.tsx';
import { Button } from '../../ui/button.tsx';
import { Empty } from '../../ui/empty.tsx';
import { orderEntries } from '../order.ts';
import { StatusBadge } from '../StatusBadge.tsx';
import { TagChips } from '../TagChip.tsx';
import { WorkflowBadge } from '../WorkflowBadge.tsx';
import { RunFilters } from './RunFilters.tsx';
import { RunWarningsBadge } from './RunWarningsBadge.tsx';

import { activeFilters, filterRuns, type RunFilter, type RunScope } from './runFilter.ts';

export function RunList({
  runs,
  selectedRun,
  selectedGroup,
  now,
  query,
  onQuery,
  filter,
  onFilter,
  onSelect,
  scope,
  onScope,
  repository,
  tagIds,
  onTagIds,
  filters = true,
}: {
  runs: RunView[];
  selectedRun: string | null;
  selectedGroup: string | null;
  now: number;
  query: string;
  onQuery: (query: string) => void;
  filter: RunFilter;
  onFilter: (filter: RunFilter) => void;
  onSelect: (runId: string, group: string | null) => void;
  /** Whose runs the list shows: those of the selected repository or of every one. */
  scope: RunScope;
  onScope: (scope: RunScope) => void;
  /** The selected repository; null until known. */
  repository: string | null;
  /** Ids of the tags to filter by (a run needs any one of them). */
  tagIds: string[];
  onTagIds: (ids: string[]) => void;
  /** Whether the filters stand above the list; false when the page shows them elsewhere. */
  filters?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { byId } = useTags();
  const only = scope === 'repository' ? repository : null;
  const shown = filterRuns(runs, query, filter, only, tagIds, byId);
  const filtered = activeFilters(query, filter, tagIds) > 0;
  return (
    <div className="flex flex-col gap-2">
      {filters ? (
        <RunFilters
          runs={runs}
          query={query}
          onQuery={onQuery}
          filter={filter}
          onFilter={onFilter}
          scope={scope}
          onScope={onScope}
          repository={repository}
          tagIds={tagIds}
          onTagIds={onTagIds}
        />
      ) : null}
      {shown.length === 0 ? (
        <Empty icon={<SearchX />} title={t('runs.list.empty')}>
          {filtered ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onQuery('');
                onFilter('all');
                onTagIds([]);
              }}
            >
              {t('runs.list.reset')}
            </Button>
          ) : null}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((run) => {
            const open = run.id === selectedRun;
            const groups = orderEntries(run);
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
                  <span className="line-clamp-2 text-sm font-medium">
                    <span className="font-mono text-xs text-muted-foreground">
                      {taskNumber(run.number)}
                    </span>{' '}
                    {runTitle(run)}
                  </span>
                  {run.name ? (
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {run.name}
                    </span>
                  ) : null}
                  <TagChips tags={run.tags ?? []} nested />
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <StatusBadge status={run.state} label={runStatusLabel(run, t)} />
                    <RunWarningsBadge run={run} />
                    {scope === 'all' ? (
                      <span className="font-medium" title={run.repository}>
                        {repositoryLabel(run.repository)}
                      </span>
                    ) : null}
                    <WorkflowBadge id={run.workflow} focusable={false} />
                    <span>{runTime(run, now, t, locale)}</span>
                    {usageText(run.usage) ? <span>{usageText(run.usage)}</span> : null}
                    {cost(run.usage) ? <span>{cost(run.usage)}</span> : null}
                    {run.diff ? <span>{diffText(run.diff, t)}</span> : null}
                  </span>
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
                          <StatusBadge status={group.status} wait={group.wait} />
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
    </div>
  );
}
