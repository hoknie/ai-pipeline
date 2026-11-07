import type { ReactNode } from 'react';

import { useMediaQuery } from '../../shared/lib/browser/media.ts';
import { Toaster } from '../../shared/ui/feedback/toaster.tsx';
import { TooltipProvider } from '../../shared/ui/feedback/tooltip.tsx';

import { MobileNav } from './nav/MobileNav.tsx';
import type { NavProps } from './nav/NavSidebar.tsx';
import { TopNav } from './nav/TopNav.tsx';

/** The navigation strip over the content (a menu bar on a narrow window) and the providers every page needs (the confirmation dialog comes from the caller). */
export function AppShell({
  nav,
  footer,
  children,
}: {
  nav: NavProps;
  /** A strip under the scrollable area, visible in every section. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const wide = useMediaQuery('(min-width: 768px)');
  return (
    <TooltipProvider>
      <div className="relative flex h-dvh flex-col overflow-hidden">
        {wide ? <TopNav {...nav} /> : <MobileNav {...nav} />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
            {children}
          </div>
          {footer}
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
