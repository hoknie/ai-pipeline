import { useTranslation } from 'react-i18next';

import type { LevelFilter } from '../specialists/index.ts';
import { Input } from '../../shared/ui/forms/input.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../shared/ui/forms/toggle-group.tsx';
import type { PipelineFilter, PipelineFilterOptions } from './pipelineFilters.ts';

import { FilterField } from '../../shared/ui/forms/filters/FilterField.tsx';

const LEVELS: LevelFilter[] = ['all', 'project', 'global'];

/** Search, level, tags and specialists of the pipelines list; chosen values are alternatives. */
export function PipelineFilters({
  filter,
  options,
  search,
  onFilter,
  onSearch,
}: {
  filter: PipelineFilter;
  options: PipelineFilterOptions;
  search: string;
  onFilter: (filter: PipelineFilter) => void;
  onSearch: (search: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={t('pipelines.filters.search')}
        placeholder={t('pipelines.filters.search')}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />
      <ToggleGroup
        type="single"
        aria-label={t('pipelines.filters.level')}
        value={filter.level}
        onValueChange={(value) => {
          if (value) onFilter({ ...filter, level: value as LevelFilter });
        }}
      >
        {LEVELS.map((level) => (
          <ToggleGroupItem key={level} value={level}>
            {t(`specialists.filters.levels.${level}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {options.tags.length > 0 ? (
        <FilterField
          label={t('pipelines.filters.tags')}
          selected={filter.tags}
          onChange={(tags) => onFilter({ ...filter, tags })}
          options={options.tags.map((tag) => ({
            value: tag.name,
            label: tag.name,
            group: tag.shared ? t('specialists.tags.shared') : t('specialists.tags.own'),
          }))}
          clearLabel={t('runs.list.clear')}
        />
      ) : null}
      {options.specialists.length > 0 ? (
        <FilterField
          label={t('pipelines.filters.specialists')}
          selected={filter.specialists}
          onChange={(specialists) => onFilter({ ...filter, specialists })}
          options={options.specialists.map((name) => ({ value: name, label: name }))}
          clearLabel={t('runs.list.clear')}
        />
      ) : null}
    </div>
  );
}
