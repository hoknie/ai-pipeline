import { clip, type TranscriptEntry } from '../feature/agents/types/index.ts';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => (isObject(part) && typeof part.text === 'string' ? part.text : ''))
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
  const record = isObject(input) ? input : {};
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

function toolCall(
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

const CLAUDE_QUIET = new Set(['system', 'rate_limit_event', 'stream_event']);

/** Transcript of the `--output-format stream-json` log of Claude Code. */
export function claudeTranscript(lines: string[], times?: (number | null)[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let cwd: string | null = null;
  // A refused call is reported twice: as a permission_denied event and as an error result.
  const denied = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    const at = times?.[index] ?? null;
    if (line.trim() === '') continue;
    const event = parse(line);
    if (!isObject(event) || typeof event.type !== 'string') {
      entries.push({ kind: 'raw', text: clip(line), at });
      continue;
    }
    if (event.type === 'system') {
      if (event.subtype === 'init' && typeof event.cwd === 'string') cwd = event.cwd;
      if (event.subtype === 'permission_denied') {
        if (typeof event.tool_use_id === 'string') denied.set(event.tool_use_id, entries.length);
        entries.push({
          kind: 'tool_result',
          id: typeof event.tool_use_id === 'string' ? event.tool_use_id : null,
          text: `permission denied: ${text(event.message ?? event.decision_reason)}`,
          error: true,
          at,
        });
      }
      continue;
    }
    if (CLAUDE_QUIET.has(event.type)) continue;
    if ((event.type === 'assistant' || event.type === 'user') && isObject(event.message)) {
      const content = event.message.content;
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: text(content) }];
      for (const block of blocks) {
        if (!isObject(block)) continue;
        if (block.type === 'text' && event.type === 'assistant' && text(block.text).trim()) {
          entries.push({ kind: 'text', text: clip(text(block.text)), at });
        } else if (block.type === 'tool_use') {
          entries.push(toolCall(block.id, String(block.name ?? 'tool'), block.input, cwd, at));
        } else if (block.type === 'tool_result') {
          const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
          const earlier = id !== null ? denied.get(id) : undefined;
          if (earlier !== undefined && block.is_error === true) {
            entries[earlier] = {
              kind: 'tool_result',
              id,
              text: clip(`permission denied: ${text(block.content)}`),
              error: true,
              at,
            };
            continue;
          }
          entries.push({
            kind: 'tool_result',
            id: typeof block.tool_use_id === 'string' ? block.tool_use_id : null,
            text: clip(text(block.content)),
            error: block.is_error === true,
            at,
          });
        }
      }
      continue;
    }
    if (event.type === 'result') {
      const usage = isObject(event.usage) ? event.usage : {};
      const input = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
        .map((key) => (typeof usage[key] === 'number' ? usage[key] : 0))
        .reduce((sum, value) => sum + value, 0);
      entries.push({
        kind: 'result',
        text: typeof event.result === 'string' ? clip(event.result) : null,
        error: event.is_error === true,
        verdict: null,
        inputTokens: isObject(event.usage) ? input : null,
        outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
        costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null,
        at,
      });
      continue;
    }
    entries.push({ kind: 'raw', text: clip(line), at });
  }
  return entries;
}

/** Readable text of an `error` event of OpenCode: the message, not the response headers. */
export function opencodeErrorText(error: unknown): string {
  if (isObject(error)) {
    const data = isObject(error.data) ? error.data : {};
    for (const candidate of [data.message, error.message, error.name]) {
      if (typeof candidate === 'string' && candidate !== '') return candidate;
    }
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

const OPENCODE_QUIET = new Set(['step_start', 'step-start']);

/** Transcript of the `run --format json` log of OpenCode. */
export function opencodeTranscript(lines: string[], times?: (number | null)[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const [index, line] of lines.entries()) {
    const at = times?.[index] ?? null;
    if (line.trim() === '') continue;
    const event = parse(line);
    if (!isObject(event)) {
      entries.push({ kind: 'raw', text: clip(line), at });
      continue;
    }
    const part = isObject(event.part) ? event.part : event;
    const type = String(part.type ?? event.type ?? '');
    if (OPENCODE_QUIET.has(type)) continue;
    if (type === 'text' && typeof part.text === 'string') {
      if (part.text.trim()) entries.push({ kind: 'text', text: clip(part.text), at });
      continue;
    }
    if (type === 'tool' || type === 'tool_use') {
      const name = String(part.tool ?? part.name ?? 'tool');
      const state = isObject(part.state) ? part.state : {};
      const id = part.callID ?? part.id ?? null;
      entries.push(toolCall(id, name, state.input ?? part.input, null, at));
      if (state.output !== undefined || state.error !== undefined) {
        entries.push({
          kind: 'tool_result',
          id: typeof id === 'string' ? id : null,
          text: clip(text(state.error ?? state.output)),
          error: state.status === 'error' || state.error !== undefined,
          at,
        });
      }
      continue;
    }
    if (type === 'step_finish' || type === 'step-finish') {
      const tokens = isObject(part.tokens) ? part.tokens : {};
      entries.push({
        kind: 'result',
        text: null,
        error: false,
        verdict: null,
        inputTokens: typeof tokens.input === 'number' ? tokens.input : null,
        outputTokens: typeof tokens.output === 'number' ? tokens.output : null,
        costUsd: typeof part.cost === 'number' ? part.cost : null,
        at,
      });
      continue;
    }
    if (type === 'error' || event.type === 'error') {
      entries.push({
        kind: 'tool_result',
        id: null,
        text: clip(opencodeErrorText(event.error ?? part)),
        error: true,
        at,
      });
      continue;
    }
    entries.push({ kind: 'raw', text: clip(line), at });
  }
  return entries;
}
