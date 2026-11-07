import { ListFilter } from 'lucide-react';
import type { ReactNode } from 'react';
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

/** The button that opens the filters in a popover (wide) or a sheet (narrow). */
export function SpecialistsFilterControl({
  count,
  wide,
  panel,
}: {
  count: number;
  wide: boolean;
  panel: ReactNode;
}) {
  const { t } = useTranslation();
  const button = (
    <Button variant="outline" size="sm" className="w-full justify-start">
      <ListFilter />
      {count > 0
        ? t('specialists.filters.buttonCount', { count })
        : t('specialists.filters.button')}
    </Button>
  );
  if (wide) {
    return (
      <Popover>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        <PopoverContent className="w-80 p-3">{panel}</PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet>
      <SheetTrigger asChild>{button}</SheetTrigger>
      <SheetContent>
        <SheetTitle>{t('specialists.filters.button')}</SheetTitle>
        <SheetDescription className="sr-only">{t('specialists.filters.button')}</SheetDescription>
        <div className="p-3">{panel}</div>
      </SheetContent>
    </Sheet>
  );
}
