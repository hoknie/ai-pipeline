import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  LIST_FIELDS,
  activeFilterCount,
  type FilterOptions,
  type LevelFilter,
  type SpecialistFilter,
} from '../specialistFilters.ts';
import { Button } from '../ui/button.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx';
import { Input } from '../ui/input.tsx';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.tsx';

import { ValuesPicker, type PickerOption } from './ValuesPicker.tsx';

const LEVELS: LevelFilter[] = ['all', 'project', 'global'];

/** Search, level and the multiselects of the specialists list; chosen values are alternatives. */
export function SpecialistFilters({
  filter,
  options,
  search,
  open,
  onFilter,
  onSearch,
  onOpen,
}: {
  filter: SpecialistFilter;
  options: FilterOptions;
  search: string;
  open: boolean;
  onFilter: (filter: SpecialistFilter) => void;
  onSearch: (search: string) => void;
  onOpen: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const count = activeFilterCount(filter);
  const plain = (names: string[]): PickerOption[] =>
    names.map((name) => ({ name, source: 'project' }));
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
      <Collapsible open={open} onOpenChange={onOpen} className="flex flex-col gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="w-fit">
            {count > 0
              ? t('specialists.filters.buttonCount', { count })
              : t('specialists.filters.button')}
            <ChevronDown />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2">
          {options.tags.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('specialists.filters.tags')}</span>
              <ValuesPicker
                label={t('specialists.filters.tags')}
                values={filter.tags}
                onChange={(tags) => onFilter({ ...filter, tags })}
                options={options.tags.map((tag) => ({
                  name: tag.name,
                  source: tag.shared ? 'global' : 'project',
                }))}
                creatable={false}
                headings={{
                  global: t('specialists.tags.shared'),
                  project: t('specialists.tags.own'),
                }}
              />
            </div>
          ) : null}
          {LIST_FIELDS.filter((field) => options[field].length > 0).map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t(`specialists.filters.${field}`)}
              </span>
              <ValuesPicker
                label={t(`specialists.filters.${field}`)}
                values={filter[field]}
                onChange={(values) => onFilter({ ...filter, [field]: values })}
                options={plain(options[field])}
                creatable={false}
                headings={{ project: '' }}
              />
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
