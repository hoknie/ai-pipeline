import { ChartTooltip } from './ChartTooltip.tsx';
import { scaleValue, type BarSlot, type ChartSeries } from './scale.ts';

export interface ChartCategory {
  key: string;
  /** The label under the bar (a short date). */
  label: string;
  /** The heading of the tip and the row of the table (a full date). */
  title: string;
}

const MUTED = { fill: 'var(--color-muted-foreground)' };

/** The horizontal grid lines with the labels of the value axis. */
export function Grid({
  ticks,
  max,
  plotWidth,
  plotHeight,
  format,
}: {
  ticks: number[];
  max: number;
  plotWidth: number;
  plotHeight: number;
  format: (value: number) => string;
}) {
  return ticks.map((tick) => {
    const y = plotHeight - scaleValue(tick, max, plotHeight);
    return (
      <g key={tick}>
        <line
          x1={0}
          x2={plotWidth}
          y1={y}
          y2={y}
          style={{ stroke: 'var(--color-border)' }}
          strokeWidth={1}
        />
        <text x={-6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} style={MUTED}>
          {format(tick)}
        </text>
      </g>
    );
  });
}

/** The stacked bar of one category, its date label and the area that reacts to the mouse. */
export function Bar({
  item,
  place,
  series,
  index,
  geometry,
  labelShown,
  dimmed,
  onEnter,
}: {
  item: ChartCategory;
  place: BarSlot;
  series: ChartSeries[];
  index: number;
  geometry: { max: number; plotHeight: number };
  labelShown: boolean;
  dimmed: boolean;
  onEnter: () => void;
}) {
  let top = geometry.plotHeight;
  return (
    <g data-testid={`bar-${item.key}`}>
      <rect
        x={place.slotX}
        y={0}
        width={place.slot}
        height={geometry.plotHeight}
        fill="transparent"
        onMouseEnter={onEnter}
      />
      {series.map((part) => {
        const height = scaleValue(part.values[index] ?? 0, geometry.max, geometry.plotHeight);
        if (height <= 0) return null;
        top -= height;
        return (
          <rect
            key={part.key}
            x={place.x}
            y={top}
            width={place.width}
            height={height}
            rx={2}
            opacity={dimmed ? 0.55 : 1}
            style={{ fill: part.color }}
          />
        );
      })}
      {labelShown ? (
        <text
          x={place.slotX + place.slot / 2}
          y={geometry.plotHeight + 16}
          textAnchor="middle"
          fontSize={11}
          style={MUTED}
        >
          {item.label}
        </text>
      ) : null}
    </g>
  );
}

/** The bars of all categories. */
export function Bars({
  categories,
  slots,
  series,
  geometry,
  labels,
  active,
  onEnter,
}: {
  categories: ChartCategory[];
  slots: BarSlot[];
  series: ChartSeries[];
  geometry: { max: number; plotHeight: number };
  labels: Set<number>;
  active: number | null;
  onEnter: (index: number) => void;
}) {
  return categories.map((item, index) => {
    const place = slots[index];
    if (place === undefined) return null;
    return (
      <Bar
        key={item.key}
        item={item}
        place={place}
        series={series}
        index={index}
        geometry={geometry}
        labelShown={labels.has(index)}
        dimmed={active !== null && active !== index}
        onEnter={() => onEnter(index)}
      />
    );
  });
}

/** The names of the series with a dot of their color. */
export function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {series.map((part) => (
        <li key={part.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: part.color }}
          />
          {part.label}
        </li>
      ))}
    </ul>
  );
}

/** The tip of the bar the mouse or the focus is on: the sum and the projects that have a value. */
export function ActiveTip({
  category,
  series,
  index,
  total,
  left,
  format,
}: {
  category: ChartCategory;
  series: ChartSeries[];
  index: number;
  total: string;
  left: number;
  format: (value: number) => string;
}) {
  return (
    <ChartTooltip
      title={category.title}
      total={total}
      left={left}
      rows={series
        .filter((part) => (part.values[index] ?? 0) > 0)
        .map((part) => ({
          key: part.key,
          label: part.label,
          color: part.color,
          value: format(part.values[index] ?? 0),
        }))}
    />
  );
}

/** The drawing: the grid with the value axis and the bars, in a box with margins. */
export function Plot({
  size,
  axis,
  bars,
  onEnter,
}: {
  size: {
    width: number;
    height: number;
    margin: { top: number; left: number };
    plotWidth: number;
    plotHeight: number;
  };
  axis: { ticks: number[]; max: number; format: (value: number) => string };
  bars: {
    categories: ChartCategory[];
    slots: BarSlot[];
    series: ChartSeries[];
    labels: Set<number>;
    active: number | null;
  };
  onEnter: (index: number) => void;
}) {
  const { plotWidth, plotHeight } = size;
  return (
    <svg width={size.width} height={size.height} aria-hidden="true" className="block">
      <g transform={`translate(${size.margin.left},${size.margin.top})`}>
        <Grid {...axis} plotWidth={plotWidth} plotHeight={plotHeight} />
        <Bars {...bars} geometry={{ max: axis.max, plotHeight }} onEnter={onEnter} />
      </g>
    </svg>
  );
}
