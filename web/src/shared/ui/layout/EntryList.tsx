import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/browser/cn.ts';
import { useMediaQuery } from '../../lib/browser/media.ts';
import { Alert } from '../feedback/alert.tsx';
import { Badge } from '../feedback/badge.tsx';

import { FilePath } from './FilePath.tsx';
import { FilterColumn } from './FilterColumn.tsx';
import type { FieldError } from '../../api/types.ts';

export interface Entry {
  id: string;
  title: ReactNode;
  /** Tooltip of the entry, for example the id behind a name. */
  hint?: string;
  subtitle?: ReactNode;
  /** Small label on the right, for example the level of a file. */
  tag?: string;
  extra?: ReactNode;
}

/** A list of configuration entries on the left: pipelines, specialists. */
export function EntryList({
  label,
  entries,
  selected,
  onSelect,
}: {
  label: string;
  entries: Entry[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            aria-current={entry.id === selected}
            className={cn(
              'flex w-full flex-col gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-left text-sm hover:bg-accent',
              entry.id === selected && 'border-border bg-accent',
            )}
            title={entry.hint}
            onClick={() => onSelect(entry.id)}
          >
            <span className="min-w-0 truncate font-medium">{entry.title}</span>
            {entry.tag || entry.subtitle ? (
              <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {entry.tag ? <Badge variant="outline">{entry.tag}</Badge> : null}
                {entry.subtitle ? <span className="min-w-0 truncate">{entry.subtitle}</span> : null}
              </span>
            ) : null}
            {entry.extra}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * List on the left, content on the right; one under the other in a narrow window.
 * With `filters`, a column of them stands before the list from 1280 px; with `onFiltersCollapsed`
 * it folds into a strip with the count of the active filters.
 */
export function SplitPage({
  side,
  filters,
  filtersLabel,
  filtersCount = 0,
  filtersCountLabel = '',
  filtersCollapsed = false,
  onFiltersCollapsed,
  children,
}: {
  side: ReactNode;
  filters?: ReactNode;
  filtersLabel?: string;
  filtersCount?: number;
  filtersCountLabel?: string;
  filtersCollapsed?: boolean;
  onFiltersCollapsed?: (collapsed: boolean) => void;
  children: ReactNode;
}) {
  const columns = useMediaQuery('(min-width: 1280px)');
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {filters && columns ? (
        onFiltersCollapsed ? (
          <FilterColumn
            label={filtersLabel ?? ''}
            count={filtersCount}
            countLabel={filtersCountLabel}
            collapsed={filtersCollapsed}
            onCollapsed={onFiltersCollapsed}
          >
            {filters}
          </FilterColumn>
        ) : (
          <aside
            aria-label={filtersLabel}
            className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3"
          >
            {filters}
          </aside>
        )
      ) : null}
      <aside className="flex shrink-0 flex-col gap-2 border-b p-3 md:w-80 md:overflow-y-auto md:border-r md:border-b-0">
        {side}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}

export function ConfigErrors({ errors }: { errors: FieldError[] }) {
  const { t } = useTranslation();
  if (errors.length === 0) return null;
  return (
    <section aria-label={t('runs.config.label')}>
      <Alert variant="destructive">
        <h3 className="mb-1 font-semibold">{t('runs.config.title')}</h3>
        <ul className="list-disc pl-4">
          {errors.map((error) => (
            <li key={`${error.file ?? ''}:${error.path}:${error.message}`}>
              {error.file ? (
                <>
                  <FilePath path={error.file} />:{' '}
                </>
              ) : null}
              <code>{error.path}</code>: {error.message}
            </li>
          ))}
        </ul>
      </Alert>
    </section>
  );
}
