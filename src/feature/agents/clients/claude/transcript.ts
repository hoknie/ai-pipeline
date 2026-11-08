import {
  clip,
  contentText,
  isJsonObject,
  parseLogLine,
  toolCallEntry,
  type JsonObject,
  type TranscriptEntry,
} from '../../types/index.ts';

const CLAUDE_QUIET = new Set(['system', 'rate_limit_event', 'stream_event']);

/** What the reading of one log keeps between its lines. */
interface Reading {
  entries: TranscriptEntry[];
  cwd: string | null;
  /** A refused call is reported twice: as a permission_denied event and as an error result. */
  denied: Map<string, number>;
}

function systemEvent(reading: Reading, event: JsonObject, at: number | null): void {
  if (event.subtype === 'init' && typeof event.cwd === 'string') reading.cwd = event.cwd;
  if (event.subtype !== 'permission_denied') return;
  const id = typeof event.tool_use_id === 'string' ? event.tool_use_id : null;
  if (id !== null) reading.denied.set(id, reading.entries.length);
  reading.entries.push({
    kind: 'tool_result',
    id,
    text: `permission denied: ${contentText(event.message ?? event.decision_reason)}`,
    error: true,
    at,
  });
}

function toolResult(reading: Reading, block: JsonObject, at: number | null): void {
  const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
  const earlier = id !== null ? reading.denied.get(id) : undefined;
  if (earlier !== undefined && block.is_error === true) {
    reading.entries[earlier] = {
      kind: 'tool_result',
      id,
      text: clip(`permission denied: ${contentText(block.content)}`),
      error: true,
      at,
    };
    return;
  }
  reading.entries.push({
    kind: 'tool_result',
    id,
    text: clip(contentText(block.content)),
    error: block.is_error === true,
    at,
  });
}

function messageEvent(reading: Reading, event: JsonObject, at: number | null): void {
  const message = event.message as JsonObject;
  const content = message.content;
  const blocks = Array.isArray(content) ? content : [{ type: 'text', text: contentText(content) }];
  for (const block of blocks) {
    if (!isJsonObject(block)) continue;
    if (block.type === 'text' && event.type === 'assistant' && contentText(block.text).trim()) {
      reading.entries.push({ kind: 'text', text: clip(contentText(block.text)), at });
    } else if (block.type === 'tool_use') {
      const name = String(block.name ?? 'tool');
      reading.entries.push(toolCallEntry(block.id, name, block.input, reading.cwd, at));
    } else if (block.type === 'tool_result') {
      toolResult(reading, block, at);
    }
  }
}

function resultEntry(event: JsonObject, at: number | null): TranscriptEntry {
  const usage = isJsonObject(event.usage) ? event.usage : {};
  const input = ['input_tokens', 'cache_creation_input_tokens']
    .map((key) => (typeof usage[key] === 'number' ? usage[key] : 0))
    .reduce((sum, value) => sum + value, 0);
  return {
    kind: 'result',
    text: typeof event.result === 'string' ? clip(event.result) : null,
    error: event.is_error === true,
    verdict: null,
    inputTokens: isJsonObject(event.usage) ? input : null,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
    costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null,
    at,
  };
}

/** Transcript of the `--output-format stream-json` log of Claude Code. */
export function claudeTranscript(lines: string[], times?: (number | null)[]): TranscriptEntry[] {
  const reading: Reading = { entries: [], cwd: null, denied: new Map() };
  for (const [index, line] of lines.entries()) {
    const at = times?.[index] ?? null;
    if (line.trim() === '') continue;
    const event = parseLogLine(line);
    if (!isJsonObject(event) || typeof event.type !== 'string') {
      reading.entries.push({ kind: 'raw', text: clip(line), at });
    } else if (event.type === 'system') {
      systemEvent(reading, event, at);
    } else if (CLAUDE_QUIET.has(event.type)) {
      continue;
    } else if (
      (event.type === 'assistant' || event.type === 'user') &&
      isJsonObject(event.message)
    ) {
      messageEvent(reading, event, at);
    } else if (event.type === 'result') {
      reading.entries.push(resultEntry(event, at));
    } else {
      reading.entries.push({ kind: 'raw', text: clip(line), at });
    }
  }
  return reading.entries;
}
