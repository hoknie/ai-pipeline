import type { MouseEvent } from 'react';

import { cn } from '../lib/cn.ts';

export interface LinkTab {
  key: string;
  label: string;
  href: string;
  selected: boolean;
  /** A tab that cannot be opened now: no navigation, `aria-disabled`. */
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
}

/** A row of tabs that are addresses: the content below is drawn from the route. */
export function LinkTabs({ label, tabs }: { label: string; tabs: LinkTab[] }) {
  return (
    <div className="border-b">
      <div role="tablist" aria-label={label} className="flex gap-1">
        {tabs.map((tab) => (
          <a
            key={tab.key}
            role="tab"
            aria-selected={tab.selected}
            aria-disabled={tab.disabled ? true : undefined}
            href={tab.disabled ? undefined : tab.href}
            onClick={(event) => {
              if (tab.disabled) {
                event.preventDefault();
                return;
              }
              tab.onClick?.(event);
            }}
            className={cn(
              '-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground',
              tab.selected && 'border-primary text-foreground',
              tab.disabled && 'pointer-events-none opacity-50',
            )}
          >
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}
