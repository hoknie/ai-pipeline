import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import {
  AreaActiveTip,
  AreaCrosshair,
  AreaGradients,
  AreaGrid,
  AreaPlot,
  AreaSlots,
  type ChartCategory,
} from './AreaParts.tsx';
import { Legend } from './BarParts.tsx';
import { DataTable } from './DataTable.tsx';
import { columnTotals, type ChartSeries } from './scale.ts';
import {
  areaNiceTicks,
  categoryXPositions,
  computeAreaLayers,
  thinCategoryLabels,
} from './spline.ts';

export type { ChartCategory };

const HEIGHT = 260;
const MARGIN = { top: 12, right: 12, bottom: 26, left: 52 };
const LABEL_WIDTH = 44;
const DEFAULT_WIDTH = 640;

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

function targetOf(key: string, at: number, last: number): number | null {
  if (key === 'ArrowRight') return Math.min(last, at + 1);
  if (key === 'ArrowLeft') return Math.max(0, at - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return null;
}

interface AreaSceneProps {
  width: number;
  series: ChartSeries[];
  idPrefix: string;
  ticks: number[];
  max: number;
  plotWidth: number;
  plotHeight: number;
  format: (value: number) => string;
  layers: ReturnType<typeof computeAreaLayers>;
  isSingle: boolean;
  categories: ChartCategory[];
  xs: number[];
  labels: Set<number>;
  active: number | null;
  activeX: number | undefined;
  onEnter: (index: number) => void;
}

function AreaScene({
  width,
  series,
  idPrefix,
  ticks,
  max,
  plotWidth,
  plotHeight,
  format,
  layers,
  isSingle,
  categories,
  xs,
  labels,
  active,
  activeX,
  onEnter,
}: AreaSceneProps) {
  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      className="block w-full overflow-visible"
      style={{ height: `${HEIGHT}px` }}
    >
      <AreaGradients series={series} idPrefix={idPrefix} />
      <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
        <AreaGrid
          ticks={ticks}
          max={max}
          plotWidth={plotWidth}
          plotHeight={plotHeight}
          format={format}
        />
        <AreaPlot
          layers={layers}
          idPrefix={idPrefix}
          plotWidth={plotWidth}
          plotHeight={plotHeight}
          isSingle={isSingle}
        />
        <AreaSlots
          categories={categories}
          xs={xs}
          plotWidth={plotWidth}
          plotHeight={plotHeight}
          labels={labels}
          onEnter={onEnter}
        />
        <AreaCrosshair active={active} activeX={activeX} plotHeight={plotHeight} layers={layers} />
      </g>
    </svg>
  );
}

export interface AreaChartProps {
  label: string;
  categories: ChartCategory[];
  series: ChartSeries[];
  format: (value: number) => string;
  categoryHead: string;
  totalLabel: string;
}

function AreaTable(props: {
  caption: string;
  categoryHead: string;
  totalLabel: string;
  categories: ChartCategory[];
  series: ChartSeries[];
  totals: number[];
  format: (value: number) => string;
}) {
  return (
    <DataTable
      caption={props.caption}
      head={[props.categoryHead, ...props.series.map((part) => part.label), props.totalLabel]}
      rows={props.categories.map((item, index) => [
        item.title,
        ...props.series.map((part) => props.format(part.values[index] ?? 0)),
        props.format(props.totals[index] ?? 0),
      ])}
    />
  );
}

function useAreaLayout(categories: ChartCategory[], series: ChartSeries[], outer: number) {
  const count = categories.length;
  const width = Math.max(outer, MARGIN.left + MARGIN.right + 10);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const totals = columnTotals(series, count);
  const peak = Math.max(0, ...totals);
  const { ticks, max } = areaNiceTicks(peak);

  const xs = categoryXPositions(count, plotWidth);
  const layers = computeAreaLayers({ series, count, plotWidth, plotHeight, max });
  const labels = thinCategoryLabels(categories, xs, LABEL_WIDTH * 1.2);

  return { width, plotWidth, plotHeight, totals, ticks, max, xs, layers, labels };
}

function AreaActiveTipOverlay(props: {
  active: number | null;
  category: ChartCategory | undefined;
  activeX: number | undefined;
  series: ChartSeries[];
  totals: number[];
  width: number;
  format: (value: number) => string;
}) {
  if (props.active === null || props.category === undefined || props.activeX === undefined)
    return null;
  return (
    <AreaActiveTip
      category={props.category}
      series={props.series}
      index={props.active}
      total={props.format(props.totals[props.active] ?? 0)}
      left={Math.min(Math.max(MARGIN.left + props.activeX, 80), props.width - 80)}
      format={props.format}
    />
  );
}

export function AreaChart(props: AreaChartProps) {
  const { label, categories, series, format, categoryHead, totalLabel } = props;
  const [ref, outer] = useWidth();
  const rawId = useId();
  const idPrefix = rawId.replace(/[^a-zA-Z0-9-_]/g, '');
  const [active, setActive] = useState<number | null>(null);

  const count = categories.length;
  const layout = useAreaLayout(categories, series, outer);

  const move = (event: KeyboardEvent) => {
    if (count <= 0) return;
    const next = targetOf(event.key, active ?? 0, count - 1);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  const activeX = active === null ? undefined : layout.xs[active];
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
        <AreaScene
          width={layout.width}
          series={series}
          idPrefix={idPrefix}
          ticks={layout.ticks}
          max={layout.max}
          plotWidth={layout.plotWidth}
          plotHeight={layout.plotHeight}
          format={format}
          layers={layout.layers}
          isSingle={count === 1}
          categories={categories}
          xs={layout.xs}
          labels={layout.labels}
          active={active}
          activeX={activeX}
          onEnter={setActive}
        />
        <AreaActiveTipOverlay
          active={active}
          category={category}
          activeX={activeX}
          series={series}
          totals={layout.totals}
          width={layout.width}
          format={format}
        />
      </div>
      <Legend series={series} />
      <AreaTable
        caption={label}
        categoryHead={categoryHead}
        totalLabel={totalLabel}
        categories={categories}
        series={series}
        totals={layout.totals}
        format={format}
      />
    </div>
  );
}
