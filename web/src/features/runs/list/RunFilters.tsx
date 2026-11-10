import { useTranslation } from 'react-i18next';

import type { RunView } from '../../../shared/api/types.ts';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../shared/ui/forms/toggle-group.tsx';
import { FilterField, type FilterOption } from '../../../shared/ui/forms/filters/FilterField.tsx';
import { useFilterOptions } from './filterOptions.tsx';
import type { RunFilterKey, RunFilterState, RunScope } from './runFilter.ts';

/** Search, repository switch and the multiselect filters of the run list. */
export function RunFilters({
  runs,
  query,
  onQuery,
  filters,
  onFilters,
  scope,
  onScope,
  repository,
  repositoryPaths,
}: {
  runs: RunView[];
  query: string;
  onQuery: (query: string) => void;
  filters: RunFilterState;
  onFilters: (filters: RunFilterState) => void;
  /** Whose runs the list shows: those of the selected repository or of every one. */
  scope: RunScope;
  onScope: (scope: RunScope) => void;
  /** The selected repository; null until known. */
  repository: string | null;
  /** The path of each repository as shown; absent: the path itself. */
  repositoryPaths?: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation();
  const options = useFilterOptions({ runs, query, filters, scope, repository, repositoryPaths });
  const set = (key: RunFilterKey) => (values: string[]) => onFilters({ ...filters, [key]: values });
  const clear = t('runs.list.clear');
  const fields: [string, RunFilterKey, FilterOption[]][] = [
    [t('runs.list.state'), 'states', options.states],
    [t('runs.list.pipeline'), 'pipelines', options.pipelines],
    [t('runs.list.specialists'), 'specialists', options.specialists],
    [t('runs.list.tags'), 'tagIds', options.tags],
  ];
  if (scope === 'all') {
    fields.push([t('runs.list.repositories'), 'repositories', options.repositories]);
  }
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
      {fields.map(([label, key, list]) => (
        <FilterField
          key={key}
          label={label}
          options={list}
          selected={filters[key]}
          onChange={set(key)}
          clearLabel={clear}
        />
      ))}
    </div>
  );
}
