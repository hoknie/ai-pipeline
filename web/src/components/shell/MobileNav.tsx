import { Menu } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sectionLabel } from '../../sections.ts';
import { Button } from '../../ui/button.tsx';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../../ui/sheet.tsx';

import { NavSidebar, type NavProps } from './NavSidebar.tsx';

/** Top bar with a button that opens the navigation in a sheet; for windows narrower than 768 px. */
export function MobileNav(props: NavProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-2">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('nav.menu')}>
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle className="sr-only">{t('nav.sectionsTitle')}</SheetTitle>
          <SheetDescription>{t('nav.sectionsDescription')}</SheetDescription>
          <NavSidebar
            {...props}
            onNavigate={(view) => {
              setOpen(false);
              props.onNavigate(view);
            }}
            onPalette={() => {
              setOpen(false);
              props.onPalette();
            }}
          />
        </SheetContent>
      </Sheet>
      <span className="text-sm font-semibold">{sectionLabel(props.view, t)}</span>
    </header>
  );
}
