import type { ReactNode } from 'react';

import { useMediaQuery } from '../../media.ts';
import { cn } from '../../lib/cn.ts';
import { Toaster } from '../../ui/toaster.tsx';
import { TooltipProvider } from '../../ui/tooltip.tsx';

import { MobileNav } from './MobileNav.tsx';
import { NavSidebar, type NavProps } from './NavSidebar.tsx';

/** Navigation next to the content (above it on a narrow window) and the providers every page needs (the confirmation dialog comes from the caller). */
export function AppShell({ nav, children }: { nav: NavProps; children: ReactNode }) {
  const wide = useMediaQuery('(min-width: 768px)');
  return (
    <TooltipProvider>
      <div className={cn('flex h-dvh', wide ? 'flex-row' : 'flex-col')}>
        {wide ? (
          <aside
            className={cn(
              'shrink-0 border-r bg-card transition-[width]',
              nav.collapsed ? 'w-14' : 'w-56',
            )}
          >
            <NavSidebar {...nav} />
          </aside>
        ) : (
          <MobileNav {...nav} />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
