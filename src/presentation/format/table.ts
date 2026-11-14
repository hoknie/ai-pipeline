import { type Style, isTerminal, plainStyle, truncateVisible, visibleWidth } from './style.ts';

export function seconds(milliseconds: number): string {
  const total = Math.round(milliseconds / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

function padVisible(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

/**
 * Columns aligned by visible width; the first row is the header, muted. In a terminal the
 * `flex` column is cut so a row fits the window (at least ten columns wide).
 */
export function table(
  rows: string[][],
  style: Style = plainStyle,
  options: { flex?: number } = {},
): string {
  const widths =
    rows[0]?.map((_, column) => Math.max(...rows.map((row) => visibleWidth(row[column] ?? '')))) ??
    [];
  const { flex } = options;
  let fit = false;
  if (flex !== undefined && isTerminal(style) && flex < widths.length) {
    const others = widths.reduce((sum, width, column) => (column === flex ? sum : sum + width), 0);
    const total = others + 2 * (widths.length - 1) + (widths[flex] ?? 0);
    if (total > style.columns) {
      widths[flex] = Math.min(
        widths[flex] ?? 0,
        Math.max(10, style.columns - others - 2 * (widths.length - 1)),
      );
      fit = true;
    }
  }
  const shown = rows.map((row, index) =>
    index === 0 ? row.map((cell) => style.muted(cell)) : row,
  );
  return shown
    .map((row) =>
      row
        .map((cell, column) =>
          padVisible(
            fit && column === flex ? truncateVisible(cell, widths[column] ?? 0) : cell,
            widths[column] ?? 0,
          ),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

/** A pipeline in text: `<name> (<id>)`, or the id alone when it has no other name. */
export function pipelineLabel(id: string, name: string): string {
  return name === id ? id : `${name} (${id})`;
}

/** The pipeline of a run with its variant, `pipeline:variant`; just the pipeline for `default`. */
export function runPipelineLabel(run: {
  pipeline: string;
  pipelineName: string;
  variant: string;
}): string {
  const label = pipelineLabel(run.pipeline, run.pipelineName);
  return run.variant === 'default' ? label : `${label}:${run.variant}`;
}

/** `#7`: how a task number is shown. */
export function taskNumber(number: number): string {
  return `#${number}`;
}

/** Local date and time of the moment, `YYYY-MM-DD HH:MM`. */
export function addedAt(milliseconds: number): string {
  const date = new Date(milliseconds);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function oneLine(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ⏎ ');
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

export function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim() !== '') ?? '';
  return line.trim().length > 80 ? `${line.trim().slice(0, 79)}…` : line.trim();
}

/** The note after `question` for a question only a person answers. */
export function humanMark(humanOnly: 'review' | 'request' | null | undefined): string {
  if (humanOnly === 'review') return ' (human review)';
  if (humanOnly === 'request') return ' (human only)';
  return '';
}
