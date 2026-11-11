/** One stacked series of a chart: a value for every category (day). */
export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export interface Ticks {
  /** Values of the ticks from zero up; the last one is the top of the axis. */
  ticks: number[];
  max: number;
}

/** The «round» step (1, 2, 2.5, 5 times a power of ten) that fits `count` intervals in `max`. */
function niceStep(max: number, count: number): number {
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const factor =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return factor * power;
}

/** Round divisions of the value axis from 0; a chart without values gets one interval of 1. */
export function niceTicks(max: number, count = 4): Ticks {
  if (!Number.isFinite(max) || max <= 0) return { ticks: [0, 1], max: 1 };
  const step = niceStep(max, count);
  const intervals = Math.ceil(max / step - 1e-9);
  const ticks = Array.from({ length: intervals + 1 }, (_, index) =>
    Number((index * step).toPrecision(12)),
  );
  return { ticks, max: ticks[ticks.length - 1] ?? 1 };
}

/** The height of `value` on an axis of `max` drawn in `height` pixels. */
export function scaleValue(value: number, max: number, height: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(height, (value / max) * height);
}

export interface BarSlot {
  /** Left edge of the bar. */
  x: number;
  width: number;
  /** Left edge of the slot of the category (the bar and its gaps). */
  slotX: number;
  slot: number;
}

/** The slots of `count` bars in `width` pixels: every bar is centered in its slot. */
export function barLayout(width: number, count: number, gapRatio = 0.25): BarSlot[] {
  if (count <= 0 || width <= 0) return [];
  const slot = width / count;
  const barWidth = Math.max(1, slot * (1 - gapRatio));
  return Array.from({ length: count }, (_, index) => ({
    slotX: index * slot,
    slot,
    width: barWidth,
    x: index * slot + (slot - barWidth) / 2,
  }));
}

/**
 * The indexes of the categories whose label is drawn, so that labels `labelWidth` wide do not
 * overlap: every n-th one, always including the first.
 */
export function thinLabels(count: number, width: number, labelWidth: number): number[] {
  if (count <= 0) return [];
  const slot = width / count;
  const every = Math.max(1, Math.ceil((labelWidth * 1.2) / Math.max(slot, 1)));
  const shown: number[] = [];
  for (let index = 0; index < count; index += every) shown.push(index);
  return shown;
}

export const OTHER_KEY = '__other';

/**
 * At most `limit` series: those with the largest sum stay in their order, the rest are summed
 * into one series «Other» that comes last.
 */
export function foldSeries(
  series: ChartSeries[],
  limit: number,
  other: { label: string; color: string },
): ChartSeries[] {
  if (series.length <= limit) return series;
  const sum = (item: ChartSeries) => item.values.reduce((total, value) => total + value, 0);
  const ranked = [...series].sort((left, right) => sum(right) - sum(left));
  const keep = new Set(ranked.slice(0, limit).map((item) => item.key));
  const rest = series.filter((item) => !keep.has(item.key));
  const length = series[0]?.values.length ?? 0;
  const values = Array.from({ length }, (_, index) =>
    rest.reduce((total, item) => total + (item.values[index] ?? 0), 0),
  );
  return [
    ...series.filter((item) => keep.has(item.key)),
    { key: OTHER_KEY, label: other.label, color: other.color, values },
  ];
}

/** The sum of the values of every category. */
export function columnTotals(series: ChartSeries[], count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    series.reduce((total, item) => total + (item.values[index] ?? 0), 0),
  );
}
