import { clip, type TranscriptEntry } from './transcript.ts';

/** A parsed JSON object of an agent log line. */
export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON value of a log line, or undefined when the line is not JSON. */
export function parseLogLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

/** Text of a content value: a string, the text parts of a list, or JSON of anything else. */
export function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => (isJsonObject(part) && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return value === undefined || value === null ? '' : JSON.stringify(value);
}

function relative(path: string, cwd: string | null): string {
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return path;
}

const PATH_TOOLS = new Set(['read', 'edit', 'write', 'multiedit', 'notebookedit']);

/** A short description of a tool call: the path, the command or the start of the input. */
export function toolSummary(name: string, input: unknown, cwd: string | null = null): string {
  const record = isJsonObject(input) ? input : {};
  const lower = name.toLowerCase();
  const path = record.file_path ?? record.filePath ?? record.notebook_path ?? record.path;
  if (PATH_TOOLS.has(lower) && typeof path === 'string') return relative(path, cwd);
  if (lower === 'bash' && typeof record.command === 'string') return record.command;
  if ((lower === 'grep' || lower === 'glob') && typeof record.pattern === 'string') {
    return typeof record.path === 'string'
      ? `${record.pattern} in ${relative(record.path, cwd)}`
      : record.pattern;
  }
  if (name.endsWith('swarm_report') && typeof record.verdict === 'string') return record.verdict;
  const json = JSON.stringify(input ?? {});
  return json.length > 120 ? `${json.slice(0, 119)}…` : json;
}

/** The transcript entry of a tool call. */
export function toolCallEntry(
  id: unknown,
  name: string,
  input: unknown,
  cwd: string | null,
  at: number | null,
): TranscriptEntry {
  return {
    kind: 'tool_call',
    id: typeof id === 'string' ? id : null,
    name,
    summary: toolSummary(name, input, cwd),
    input: clip(JSON.stringify(input ?? {}, null, 2)),
    at,
  };
}
