import { useTranslation } from 'react-i18next';

import type { LevelFilter } from '../specialists/index.ts';
import { Input } from '../../shared/ui/forms/input.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../shared/ui/forms/toggle-group.tsx';
import type { PipelineFilter, PipelineFilterOptions } from './pipelineFilters.ts';

import { ValuesPicker } from '../../shared/ui/forms/ValuesPicker.tsx';

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
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('pipelines.filters.tags')}</span>
          <ValuesPicker
            label={t('pipelines.filters.tags')}
            values={filter.tags}
            onChange={(tags) => onFilter({ ...filter, tags })}
            options={options.tags.map((tag) => ({
              name: tag.name,
              source: tag.shared ? 'global' : 'project',
            }))}
            creatable={false}
            headings={{ global: t('specialists.tags.shared'), project: t('specialists.tags.own') }}
          />
        </div>
      ) : null}
      {options.specialists.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {t('pipelines.filters.specialists')}
          </span>
          <ValuesPicker
            label={t('pipelines.filters.specialists')}
            values={filter.specialists}
            onChange={(specialists) => onFilter({ ...filter, specialists })}
            options={options.specialists.map((name) => ({ name, source: 'project' as const }))}
            creatable={false}
            headings={{ project: '' }}
          />
        </div>
      ) : null}
    </div>
  );
}
