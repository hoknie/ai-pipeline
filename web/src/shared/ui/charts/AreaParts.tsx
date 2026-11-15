import { ChartTooltip } from './ChartTooltip.tsx';
import type { ChartCategory } from './BarParts.tsx';
import type { AreaLayer } from './spline.ts';
import type { ChartSeries } from './scale.ts';

export type { ChartCategory };

const MUTED = { fill: 'var(--color-muted-foreground)' };

export function AreaGradients({ series, idPrefix }: { series: ChartSeries[]; idPrefix: string }) {
  return (
    <defs>
      {series.map((part, index) => (
        <linearGradient key={part.key} id={`${idPrefix}-grad-${index}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={part.color} stopOpacity="0.40" />
          <stop offset="100%" stopColor={part.color} stopOpacity="0.05" />
        </linearGradient>
      ))}
    </defs>
  );
}

export function AreaGrid({
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
  return (
    <g data-testid="chart-grid">
      {ticks.map((tick) => {
        const y =
          max <= 0 ? plotHeight : plotHeight - Math.min(plotHeight, (tick / max) * plotHeight);
        const isBase = tick === 0;
        return (
          <g key={tick}>
            <line
              x1={0}
              x2={plotWidth}
              y1={y}
              y2={y}
              stroke="var(--color-border)"
              strokeWidth={1}
              strokeDasharray={isBase ? undefined : '3 3'}
            />
            <text
              x={-6}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              style={MUTED}
            >
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function AreaPlot({
  layers,
  idPrefix,
  plotWidth,
  plotHeight,
  isSingle,
}: {
  layers: AreaLayer[];
  idPrefix: string;
  plotWidth: number;
  plotHeight: number;
  isSingle: boolean;
}) {
  if (isSingle) {
    const x = plotWidth / 2;
    return (
      <g data-testid="area-single-point">
        <line
          x1={x}
          x2={x}
          y1={0}
          y2={plotHeight}
          stroke="var(--color-border)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
        {layers.map((layer) => {
          const pt = layer.points[0];
          const val = layer.series.values[0] ?? 0;
          if (!pt || val <= 0) return null;
          return (
            <circle
              key={layer.series.key}
              cx={pt.x}
              cy={pt.y}
              r={4}
              fill={layer.series.color}
              stroke="var(--color-card)"
              strokeWidth={2}
              data-testid={`point-${layer.series.key}`}
            />
          );
        })}
      </g>
    );
  }

  return (
    <g data-testid="area-layers">
      {layers.map((layer, index) => (
        <path
          key={layer.series.key}
          d={layer.areaPath}
          fill={`url(#${idPrefix}-grad-${index})`}
          data-testid={`area-series-${layer.series.key}`}
        />
      ))}
      {layers.map((layer) =>
        layer.strokePaths.map((pathD, sIdx) => (
          <path
            key={`${layer.series.key}-${sIdx}`}
            d={pathD}
            fill="none"
            stroke={layer.series.color}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )),
      )}
    </g>
  );
}

export function AreaSlots({
  categories,
  xs,
  plotWidth,
  plotHeight,
  labels,
  onEnter,
}: {
  categories: ChartCategory[];
  xs: number[];
  plotWidth: number;
  plotHeight: number;
  labels: Set<number>;
  onEnter: (index: number) => void;
}) {
  const count = categories.length;
  return (
    <g data-testid="chart-slots">
      {categories.map((item, index) => {
        let x = 0;
        let width = plotWidth;
        if (count > 1) {
          const prevX = index === 0 ? xs[0]! : (xs[index - 1]! + xs[index]!) / 2;
          const nextX = index === count - 1 ? xs[count - 1]! : (xs[index]! + xs[index + 1]!) / 2;
          x = prevX;
          width = Math.max(1, nextX - prevX);
        }
        return (
          <g key={item.key} data-testid={`slot-${item.key}`}>
            <rect
              x={x}
              y={0}
              width={width}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => onEnter(index)}
            >
              <title>{item.title}</title>
            </rect>
            {labels.has(index) ? (
              <text
                x={xs[index] ?? 0}
                y={plotHeight + 16}
                textAnchor="middle"
                fontSize={11}
                style={MUTED}
              >
                {item.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

export function AreaCrosshair({
  active,
  activeX,
  plotHeight,
  layers,
}: {
  active: number | null;
  activeX: number | undefined;
  plotHeight: number;
  layers: AreaLayer[];
}) {
  if (active === null || activeX === undefined) return null;
  return (
    <g data-testid="crosshair">
      <line
        x1={activeX}
        x2={activeX}
        y1={0}
        y2={plotHeight}
        stroke="var(--color-muted-foreground)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      {layers.map((layer) => {
        const pt = layer.points[active];
        const val = layer.series.values[active] ?? 0;
        if (!pt || val <= 0) return null;
        return (
          <circle
            key={layer.series.key}
            cx={pt.x}
            cy={pt.y}
            r={4}
            fill={layer.series.color}
            stroke="var(--color-card)"
            strokeWidth={2}
            data-testid={`marker-${layer.series.key}`}
          />
        );
      })}
    </g>
  );
}

export function AreaActiveTip({
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
