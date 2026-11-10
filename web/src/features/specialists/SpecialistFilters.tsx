import { useTranslation } from 'react-i18next';

import {
  LIST_FIELDS,
  type FilterOptions,
  type LevelFilter,
  type SpecialistFilter,
} from './specialistFilters.ts';
import { Input } from '../../shared/ui/forms/input.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../shared/ui/forms/toggle-group.tsx';

import { FilterField, type FilterOption } from '../../shared/ui/forms/filters/FilterField.tsx';

const LEVELS: LevelFilter[] = ['all', 'project', 'global'];

/** Search, level and the multiselects of the specialists list; chosen values are alternatives. */
export function SpecialistFilters({
  filter,
  options,
  search,
  onFilter,
  onSearch,
}: {
  filter: SpecialistFilter;
  options: FilterOptions;
  search: string;
  onFilter: (filter: SpecialistFilter) => void;
  onSearch: (search: string) => void;
}) {
  const { t } = useTranslation();
  const clear = t('runs.list.clear');
  const plain = (names: string[]): FilterOption[] =>
    names.map((name) => ({ value: name, label: name }));
  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={t('specialists.filters.search')}
        placeholder={t('specialists.filters.search')}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          aria-label={t('specialists.filters.level')}
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
      </div>
      {options.tags.length > 0 ? (
        <FilterField
          label={t('specialists.filters.tags')}
          selected={filter.tags}
          onChange={(tags) => onFilter({ ...filter, tags })}
          options={options.tags.map((tag) => ({
            value: tag.name,
            label: tag.name,
            group: tag.shared ? t('specialists.tags.shared') : t('specialists.tags.own'),
          }))}
          clearLabel={clear}
        />
      ) : null}
      {LIST_FIELDS.filter((field) => options[field].length > 0).map((field) => (
        <FilterField
          key={field}
          label={t(`specialists.filters.${field}`)}
          selected={filter[field]}
          onChange={(values) => onFilter({ ...filter, [field]: values })}
          options={plain(options[field])}
          clearLabel={clear}
        />
      ))}
    </div>
  );
}
