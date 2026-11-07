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
import { RunFilters } from '../list/RunFilters.tsx';
import type { FilterProps } from './types.ts';

/** The filters behind a button: a popover in a wide window, a sheet in a narrow one. */
export function FiltersControl({
  filterProps,
  count,
  wide,
}: {
  filterProps: FilterProps;
  count: number;
  wide: boolean;
}) {
  const { t } = useTranslation();
  const button = (
    <Button variant="outline" size="sm" className="w-full justify-start">
      <ListFilter />
      {count > 0 ? t('runs.list.filtersCount', { count }) : t('runs.list.filters')}
    </Button>
  );
  return wide ? (
    <Popover>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent className="w-80 p-3">
        <RunFilters {...filterProps} />
      </PopoverContent>
    </Popover>
  ) : (
    <Sheet>
      <SheetTrigger asChild>{button}</SheetTrigger>
      <SheetContent>
        <SheetTitle>{t('runs.list.filters')}</SheetTitle>
        <SheetDescription className="sr-only">{t('runs.list.filters')}</SheetDescription>
        <div className="p-3">
          <RunFilters {...filterProps} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
