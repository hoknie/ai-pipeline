import {
  clip,
  contentText,
  isJsonObject,
  parseLogLine,
  toolCallEntry,
  type JsonObject,
  type TranscriptEntry,
} from '../../types/index.ts';

/** Readable text of an `error` event of OpenCode: the message, not the response headers. */
export function opencodeErrorText(error: unknown): string {
  if (isJsonObject(error)) {
    const data = isJsonObject(error.data) ? error.data : {};
    for (const candidate of [data.message, error.message, error.name]) {
      if (typeof candidate === 'string' && candidate !== '') return candidate;
    }
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

const OPENCODE_QUIET = new Set(['step_start', 'step-start']);

function toolEntries(part: JsonObject, at: number | null): TranscriptEntry[] {
  const name = String(part.tool ?? part.name ?? 'tool');
  const state = isJsonObject(part.state) ? part.state : {};
  const id = part.callID ?? part.id ?? null;
  const entries = [toolCallEntry(id, name, state.input ?? part.input, null, at)];
  if (state.output !== undefined || state.error !== undefined) {
    entries.push({
      kind: 'tool_result',
      id: typeof id === 'string' ? id : null,
      text: clip(contentText(state.error ?? state.output)),
      error: state.status === 'error' || state.error !== undefined,
      at,
    });
  }
  return entries;
}

function stepFinishEntry(part: JsonObject, at: number | null): TranscriptEntry {
  const tokens = isJsonObject(part.tokens) ? part.tokens : {};
  return {
    kind: 'result',
    text: null,
    error: false,
    verdict: null,
    inputTokens: typeof tokens.input === 'number' ? tokens.input : null,
    outputTokens: typeof tokens.output === 'number' ? tokens.output : null,
    costUsd: typeof part.cost === 'number' ? part.cost : null,
    at,
  };
}

/** The entries of one JSON event of the log. */
function eventEntries(event: JsonObject, line: string, at: number | null): TranscriptEntry[] {
  const part = isJsonObject(event.part) ? event.part : event;
  const type = String(part.type ?? event.type ?? '');
  if (OPENCODE_QUIET.has(type)) return [];
  if (type === 'text' && typeof part.text === 'string') {
    return part.text.trim() ? [{ kind: 'text', text: clip(part.text), at }] : [];
  }
  if (type === 'tool' || type === 'tool_use') return toolEntries(part, at);
  if (type === 'step_finish' || type === 'step-finish') return [stepFinishEntry(part, at)];
  if (type === 'error' || event.type === 'error') {
    const text = clip(opencodeErrorText(event.error ?? part));
    return [{ kind: 'tool_result', id: null, text, error: true, at }];
  }
  return [{ kind: 'raw', text: clip(line), at }];
}

/** Transcript of the `run --format json` log of OpenCode. */
export function opencodeTranscript(lines: string[], times?: (number | null)[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const [index, line] of lines.entries()) {
    const at = times?.[index] ?? null;
    if (line.trim() === '') continue;
    const event = parseLogLine(line);
    if (!isJsonObject(event)) entries.push({ kind: 'raw', text: clip(line), at });
    else entries.push(...eventEntries(event, line, at));
  }
  return entries;
}
