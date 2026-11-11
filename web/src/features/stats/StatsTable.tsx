import type { ReactNode } from 'react';

import { cn } from '../../shared/lib/browser/cn.ts';
import type { Sort } from './statsView.ts';

export interface StatsColumn<T> {
  key: string;
  label: string;
  /** Numbers are aligned to the right. */
  numeric?: boolean;
  cell: (row: T) => ReactNode;
}

/**
 * A table whose headers sort it; `pinned` stays on top whatever the sort. A table wider than
 * the window scrolls inside its own box.
 */
export function StatsTable<T>({
  caption,
  columns,
  rows,
  pinned,
  sort,
  onSort,
  rowKey,
}: {
  caption: string;
  columns: StatsColumn<T>[];
  rows: T[];
  pinned?: T;
  sort: Sort | null;
  onSort: (key: string) => void;
  rowKey: (row: T) => string;
}) {
  const line = (row: T, bold: boolean) => (
    <tr key={rowKey(row)} className={cn('border-t', bold && 'bg-muted/40 font-medium')}>
      {columns.map((column) => (
        <td
          key={column.key}
          className={cn('px-3 py-1.5', column.numeric && 'text-right tabular-nums')}
        >
          {column.cell(row)}
        </td>
      ))}
    </tr>
  );
  return (
    <div className="overflow-x-auto" data-testid="stats-table-scroll">
      <table className="w-full min-w-max text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className={cn('px-3 py-1.5 font-medium', column.numeric && 'text-right')}
                >
                  <button
                    type="button"
                    className="rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSort(column.key)}
                  >
                    {column.label}
                    {active ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {pinned === undefined ? null : line(pinned, true)}
          {rows.map((row) => line(row, false))}
        </tbody>
      </table>
    </div>
  );
}
