import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../forms/button.tsx';
import { FILTERS_WIDTH, STRIP_WIDTH } from './filterWidths.ts';

/** The column of the filters: expanded, or a strip with the count of the active ones. */
export function FilterColumn({
  children,
  label,
  count,
  countLabel,
  collapsed,
  onCollapsed,
}: {
  children: ReactNode;
  /** The name of the column. */
  label: string;
  /** How many filters are active. */
  count: number;
  /** The name of the number on the strip, such as «Filters (2)». */
  countLabel: string;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
}) {
  const { t } = useTranslation();
  return collapsed ? (
    <aside
      aria-label={label}
      data-filters="collapsed"
      style={{ width: STRIP_WIDTH }}
      className="flex shrink-0 flex-col items-center gap-2 border-r py-3"
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('filters.expand')}
        title={t('filters.expand')}
        onClick={() => onCollapsed(false)}
      >
        <PanelLeftOpen />
      </Button>
      {count > 0 ? (
        <span
          aria-label={countLabel}
          className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
        >
          {count}
        </span>
      ) : null}
    </aside>
  ) : (
    <aside
      aria-label={label}
      data-filters="expanded"
      style={{ width: FILTERS_WIDTH }}
      className="flex shrink-0 flex-col gap-2 overflow-y-auto border-r p-3"
    >
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        aria-label={t('filters.collapse')}
        onClick={() => onCollapsed(true)}
      >
        <PanelLeftClose />
        {t('filters.collapse')}
      </Button>
      {children}
    </aside>
  );
}
