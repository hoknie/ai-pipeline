import { useTranslation } from 'react-i18next';

import type { LevelFilter } from '../specialistFilters.ts';
import { Input } from '../ui/input.tsx';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.tsx';
import type { WorkflowFilter, WorkflowFilterOptions } from '../workflowFilters.ts';

import { ValuesPicker } from './ValuesPicker.tsx';

const LEVELS: LevelFilter[] = ['all', 'project', 'global'];

/** Search, level, tags and specialists of the pipelines list; chosen values are alternatives. */
export function WorkflowFilters({
  filter,
  options,
  search,
  onFilter,
  onSearch,
}: {
  filter: WorkflowFilter;
  options: WorkflowFilterOptions;
  search: string;
  onFilter: (filter: WorkflowFilter) => void;
  onSearch: (search: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={t('workflows.filters.search')}
        placeholder={t('workflows.filters.search')}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />
      <ToggleGroup
        type="single"
        aria-label={t('workflows.filters.level')}
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
          <span className="text-xs text-muted-foreground">{t('workflows.filters.tags')}</span>
          <ValuesPicker
            label={t('workflows.filters.tags')}
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
            {t('workflows.filters.specialists')}
          </span>
          <ValuesPicker
            label={t('workflows.filters.specialists')}
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
