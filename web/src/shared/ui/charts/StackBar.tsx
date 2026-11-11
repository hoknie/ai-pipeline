import { DataTable } from './DataTable.tsx';

export interface StackSegment {
  key: string;
  label: string;
  color: string;
  value: number;
}

/** One bar split into parts by their values, with a legend that names every part. */
export function StackBar({
  label,
  segments,
  valueHead,
  nameHead,
}: {
  /** The accessible name of the chart. */
  label: string;
  segments: StackSegment[];
  valueHead: string;
  nameHead: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.key}
              data-testid={`stack-${segment.key}`}
              style={{ width: `${(segment.value / total) * 100}%`, backgroundColor: segment.color }}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span>{segment.label}</span>
            <span className="tabular-nums text-muted-foreground">{segment.value}</span>
          </li>
        ))}
      </ul>
      <DataTable
        caption={label}
        head={[nameHead, valueHead]}
        rows={segments.map((segment) => [segment.label, String(segment.value)])}
      />
    </div>
  );
}
