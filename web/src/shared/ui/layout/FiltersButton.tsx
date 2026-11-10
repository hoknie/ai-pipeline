import { ListFilter } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../forms/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../overlays/popover.tsx';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../overlays/sheet.tsx';

/** The filters behind a button: a popover in a wide window, a sheet in a narrow one. */
export function FiltersButton({
  label,
  countLabel,
  wide,
  children,
}: {
  label: string;
  /** The text of the button while filters are active, such as «Filters (2)»; null for none. */
  countLabel: string | null;
  wide: boolean;
  children: ReactNode;
}) {
  const button = (
    <Button variant="outline" size="sm" className="w-full justify-start">
      <ListFilter />
      {countLabel ?? label}
    </Button>
  );
  return wide ? (
    <Popover>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent className="w-80 p-3">{children}</PopoverContent>
    </Popover>
  ) : (
    <Sheet>
      <SheetTrigger asChild>{button}</SheetTrigger>
      <SheetContent>
        <SheetTitle>{label}</SheetTitle>
        <SheetDescription className="sr-only">{label}</SheetDescription>
        <div className="p-3">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
