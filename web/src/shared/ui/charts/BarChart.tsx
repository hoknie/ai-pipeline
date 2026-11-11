import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { ActiveTip, Legend, Plot, type ChartCategory } from './BarParts.tsx';
import { DataTable } from './DataTable.tsx';
import { barLayout, columnTotals, niceTicks, thinLabels, type ChartSeries } from './scale.ts';

export type { ChartCategory };

const HEIGHT = 240;
const MARGIN = { top: 8, right: 8, bottom: 24, left: 48 };
const LABEL_WIDTH = 44;
const DEFAULT_WIDTH = 640;

/** The width of the element, followed with a `ResizeObserver`. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const measure = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The bar that arrow keys, Home and End lead to; null for any other key. */
function targetOf(key: string, at: number, last: number): number | null {
  if (key === 'ArrowRight') return Math.min(last, at + 1);
  if (key === 'ArrowLeft') return Math.max(0, at - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return null;
}

/**
 * Stacked bars by category: axes, grid, a tip on hover and on focus, arrow keys between bars. The
 * chart knows nothing of what it draws: the series and the way a value is written are given.
 */
export function BarChart({
  label,
  categories,
  series,
  format,
  categoryHead,
  totalLabel,
}: {
  /** The accessible name of the chart. */
  label: string;
  categories: ChartCategory[];
  series: ChartSeries[];
  /** Writes a value for the axis, the tip and the table. */
  format: (value: number) => string;
  categoryHead: string;
  totalLabel: string;
}) {
  const [ref, outer] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const width = Math.max(outer, MARGIN.left + MARGIN.right + 10);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const totals = columnTotals(series, categories.length);
  const { ticks, max } = niceTicks(Math.max(0, ...totals));
  const slots = barLayout(plotWidth, categories.length);
  const labels = new Set(thinLabels(categories.length, plotWidth, LABEL_WIDTH));

  const move = (event: KeyboardEvent) => {
    const next = targetOf(event.key, active ?? 0, categories.length - 1);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  const slot = active === null ? undefined : slots[active];
  const category = active === null ? undefined : categories[active];
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={ref}
        role="group"
        aria-label={label}
        tabIndex={0}
        className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onFocus={() => setActive((current) => current ?? 0)}
        onBlur={() => setActive(null)}
        onKeyDown={move}
        onMouseLeave={() => setActive(null)}
      >
        <Plot
          size={{ width, height: HEIGHT, margin: MARGIN, plotWidth, plotHeight }}
          axis={{ ticks, max, format }}
          bars={{ categories, slots, series, labels, active }}
          onEnter={setActive}
        />
        {active !== null && category !== undefined && slot !== undefined ? (
          <ActiveTip
            category={category}
            series={series}
            index={active}
            total={format(totals[active] ?? 0)}
            left={Math.min(Math.max(MARGIN.left + slot.slotX + slot.slot / 2, 80), width - 80)}
            format={format}
          />
        ) : null}
      </div>
      <Legend series={series} />
      <DataTable
        caption={label}
        head={[categoryHead, ...series.map((part) => part.label), totalLabel]}
        rows={categories.map((item, index) => [
          item.title,
          ...series.map((part) => format(part.values[index] ?? 0)),
          format(totals[index] ?? 0),
        ])}
      />
    </div>
  );
}
