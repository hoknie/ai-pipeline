import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cost, diffText, runTime, runTitle } from '../../format.ts';
import { useLocale } from '../../i18n/index.ts';
import { cn } from '../../lib/cn.ts';
import { repositoryLabel } from '../../repositories.ts';
import { runStatusLabel } from '../../status.ts';
import type { RunView } from '../../types.ts';
import { Button } from '../../ui/button.tsx';
import { Empty } from '../../ui/empty.tsx';
import { Input } from '../../ui/input.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.tsx';
import { orderGroups } from '../order.ts';
import { StatusBadge } from '../StatusBadge.tsx';
import { RunWarningsBadge } from './RunWarningsBadge.tsx';

import {
  filterCounts,
  filterRuns,
  RUN_FILTERS,
  runsOf,
  type RunFilter,
  type RunScope,
} from './runFilter.ts';

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
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const only = scope === 'repository' ? repository : null;
  const shown = filterRuns(runs, query, filter, only);
  const counts = filterCounts(runsOf(runs, only));
  const filtered = query.trim() !== '' || filter !== 'all';
  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={t('runs.list.search')}
        placeholder={t('runs.list.search')}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <ToggleGroup
        type="single"
        aria-label={t('runs.list.scope')}
        value={scope}
        className="flex-wrap"
        onValueChange={(value) => value && onScope(value as RunScope)}
      >
        <ToggleGroupItem value="repository">{t('runs.list.scopeRepository')}</ToggleGroupItem>
        <ToggleGroupItem value="all">{t('runs.list.scopeAll')}</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup
        type="single"
        aria-label={t('runs.list.filter')}
        value={filter}
        className="flex-wrap"
        onValueChange={(value) => value && onFilter(value as RunFilter)}
      >
        {RUN_FILTERS.map(({ value, labelKey }) => (
          <ToggleGroupItem key={value} value={value}>
            {t(`runs.list.${labelKey}`)} {counts[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {shown.length === 0 ? (
        <Empty icon={<SearchX />} title={t('runs.list.empty')}>
          {filtered ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onQuery('');
                onFilter('all');
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
            const groups = orderGroups(run.groups);
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
                  <span className="line-clamp-2 text-sm font-medium">{runTitle(run)}</span>
                  {run.name ? (
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {run.name}
                    </span>
                  ) : null}
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <StatusBadge status={run.state} label={runStatusLabel(run, t)} />
                    <RunWarningsBadge run={run} />
                    {scope === 'all' ? (
                      <span className="font-medium" title={run.repository}>
                        {repositoryLabel(run.repository)}
                      </span>
                    ) : null}
                    <span>{run.workflow}</span>
                    {run.fromQueue ? <span>{t('runs.list.fromQueue')}</span> : null}
                    <span>{runTime(run, now, t, locale)}</span>
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
                            {group.title}
                          </span>
                          <StatusBadge status={group.status} />
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
