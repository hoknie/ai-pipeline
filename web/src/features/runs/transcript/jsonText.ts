/** Readable text for JSON in the transcript: `key: value` lines instead of braces and quotes. */

type Container = unknown[] | Record<string, unknown>;

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null;
}

function isFilled(value: unknown): value is Container {
  return isContainer(value) && Object.keys(value).length > 0;
}

/** The value of a text that is a JSON object or array; `undefined` for anything else. */
export function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isContainer(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return '[]';
  if (isContainer(value)) return '{}';
  return JSON.stringify(value) ?? String(value);
}

function indent(lines: string[]): string[] {
  return lines.map((line) => `  ${line}`);
}

function lines(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return ['[]'];
    return value.flatMap((item): string[] => {
      if (isFilled(item)) {
        const [first = '', ...rest] = lines(item);
        return [`- ${first}`, ...indent(rest)];
      }
      const text = scalar(item);
      return text.includes('\n') ? ['-', ...indent(text.split('\n'))] : [`- ${text}`];
    });
  }
  if (isContainer(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return ['{}'];
    return entries.flatMap(([key, item]): string[] => {
      if (isFilled(item)) return [`${key}:`, ...indent(lines(item))];
      const text = scalar(item);
      return text.includes('\n') ? [`${key}:`, ...indent(text.split('\n'))] : [`${key}: ${text}`];
    });
  }
  return scalar(value).split('\n');
}

/** Multi-line `key: value` text, nested values indented, array items after `- `. */
export function readableJson(value: unknown): string {
  return lines(value).join('\n');
}

function inline(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.length}]`;
  if (isContainer(value)) return Object.keys(value).length === 0 ? '{}' : '{…}';
  return scalar(value).replace(/\s*\n\s*/g, ' ');
}

/** One line `key: value · key: value`, cut to `limit` characters with `…`. */
export function readableSummary(value: unknown, limit = 120): string {
  const parts = Array.isArray(value)
    ? value.map(inline)
    : isContainer(value)
      ? Object.entries(value).map(([key, item]) => `${key}: ${inline(item)}`)
      : [inline(value)];
  const text = parts.join(' · ');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Whether the summary of a call is the JSON fallback of its input rather than a description. */
export function isJsonSummary(summary: string, input: string): boolean {
  const value = parseJson(input);
  if (value === undefined) return false;
  const json = JSON.stringify(value);
  return summary === json || (json.length > 120 && summary === `${json.slice(0, 119)}…`);
}
