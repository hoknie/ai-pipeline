import { DataTable } from './DataTable.tsx';

export interface ShareRow {
  key: string;
  label: string;
  color: string;
  value: number;
  /** The value as shown, such as `90k`. */
  text: string;
}

/** Horizontal bars of the shares of the rows in their total: name, value and percent. */
export function ShareBars({
  label,
  rows,
  valueHead,
  nameHead,
}: {
  /** The accessible name of the chart. */
  label: string;
  rows: ShareRow[];
  valueHead: string;
  nameHead: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const percent = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.key}
            tabIndex={0}
            aria-label={`${row.label}: ${row.text} · ${percent(row.value)}%`}
            className="flex flex-col gap-1 rounded-sm text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex justify-between gap-2">
              <span className="truncate">{row.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {row.text} · {percent(row.value)}%
              </span>
            </span>
            <span className="h-2 rounded-full bg-muted" aria-hidden="true">
              <span
                className="block h-2 rounded-full"
                style={{ width: `${percent(row.value)}%`, backgroundColor: row.color }}
              />
            </span>
          </li>
        ))}
      </ul>
      <DataTable
        caption={label}
        head={[nameHead, valueHead, '%']}
        rows={rows.map((row) => [row.label, row.text, `${percent(row.value)}%`])}
      />
    </div>
  );
}
