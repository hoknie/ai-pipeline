export interface TooltipRow {
  key: string;
  label: string;
  color: string;
  value: string;
}

/**
 * The tip of a chart: the heading (a day), the total and a row with a dot of the color for every
 * series. It is a live region, so a screen reader hears it when the focus moves.
 */
export function ChartTooltip({
  title,
  total,
  rows,
  left,
}: {
  title: string;
  total: string;
  rows: TooltipRow[];
  /** Horizontal position of the center of the tip in the chart, px; null places it at the left. */
  left: number | null;
}) {
  return (
    <div
      role="status"
      data-testid="chart-tooltip"
      className="pointer-events-none absolute top-0 z-10 min-w-40 max-w-64 -translate-x-1/2 rounded-md border bg-card p-2 text-xs text-card-foreground shadow-md"
      style={{ left: left ?? 0 }}
    >
      <div className="flex justify-between gap-3 font-medium">
        <span>{title}</span>
        <span>{total}</span>
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="truncate">{row.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
