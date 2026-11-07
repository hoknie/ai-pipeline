import { ListFilter } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/overlays/popover.tsx';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../../../shared/ui/overlays/sheet.tsx';
import { PipelineFilters } from '../PipelineFilters.tsx';
import type { PipelineFilterState } from './usePipelineFilterState.ts';

/** The fields of the filter. */
export function FiltersPanel({ filters }: { filters: PipelineFilterState }) {
  return (
    <PipelineFilters
      filter={filters.filter}
      options={filters.options}
      search={filters.search}
      onFilter={filters.setFilter}
      onSearch={filters.setSearch}
    />
  );
}

/** The filters of the list: a popover on a wide window, a sheet on a narrow one. */
export function FiltersControl({
  filters,
  count,
  wide,
}: {
  filters: PipelineFilterState;
  count: number;
  wide: boolean;
}) {
  const { t } = useTranslation();
  const content = <FiltersPanel filters={filters} />;
  const button = (
    <Button variant="outline" size="sm" className="w-full justify-start">
      <ListFilter />
      {count > 0 ? t('pipelines.filters.buttonCount', { count }) : t('pipelines.filters.button')}
    </Button>
  );
  return wide ? (
    <Popover>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent className="w-80 p-3">{content}</PopoverContent>
    </Popover>
  ) : (
    <Sheet>
      <SheetTrigger asChild>{button}</SheetTrigger>
      <SheetContent>
        <SheetTitle>{t('pipelines.filters.button')}</SheetTitle>
        <SheetDescription className="sr-only">{t('pipelines.filters.button')}</SheetDescription>
        <div className="p-3">{content}</div>
      </SheetContent>
    </Sheet>
  );
}
