import { useTranslation } from 'react-i18next';

import { Input } from '../../ui/input.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.tsx';
import type { RunView } from '../../types.ts';
import { useTags } from '../../tags.tsx';
import { TagPicker } from '../TagPicker.tsx';

import { filterCounts, RUN_FILTERS, runsOf, type RunFilter, type RunScope } from './runFilter.ts';

/** Repository switch, search, status filter with counters and tags of the run list. */
export function RunFilters({
  runs,
  query,
  onQuery,
  filter,
  onFilter,
  scope,
  onScope,
  repository,
  tagIds,
  onTagIds,
}: {
  runs: RunView[];
  query: string;
  onQuery: (query: string) => void;
  filter: RunFilter;
  onFilter: (filter: RunFilter) => void;
  /** Whose runs the list shows: those of the selected repository or of every one. */
  scope: RunScope;
  onScope: (scope: RunScope) => void;
  /** The selected repository; null until known. */
  repository: string | null;
  tagIds: string[];
  onTagIds: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const { byId } = useTags();
  const counts = filterCounts(
    runsOf(runs, scope === 'repository' ? repository : null),
    tagIds,
    byId,
  );
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
      <TagPicker
        label={t('runs.list.tags')}
        selected={tagIds}
        onChange={onTagIds}
        repository={repository}
      />
    </div>
  );
}
