import type { ReactNode } from 'react';

import { useMediaQuery } from '../../media.ts';
import { Toaster } from '../../ui/toaster.tsx';
import { TooltipProvider } from '../../ui/tooltip.tsx';

import { MobileNav } from './MobileNav.tsx';
import type { NavProps } from './NavSidebar.tsx';
import { TopNav } from './TopNav.tsx';

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
      <div className="flex h-dvh flex-col">
        {wide ? <TopNav {...nav} /> : <MobileNav {...nav} />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
          {footer}
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
