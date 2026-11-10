import type { TranscriptEntry } from '../../../shared/api/types.ts';

type ToolCall = Extract<TranscriptEntry, { kind: 'tool_call' }>;
type ToolResult = Extract<TranscriptEntry, { kind: 'tool_result' }>;

export type Block =
  | { kind: 'call'; call: ToolCall; results: ToolResult[] }
  | { kind: 'entry'; entry: TranscriptEntry };

/** Coalesces only adjacent additive fragments, while preserving tool grouping and boundaries. */
export function blocks(entries: TranscriptEntry[]): Block[] {
  const result: Block[] = [];
  const calls = new Map<string, Extract<Block, { kind: 'call' }>>();
  let streamId: string | undefined;
  let fragments: Extract<TranscriptEntry, { kind: 'text' }>[] = [];
  const flush = () => {
    if (fragments.length === 1) result.push({ kind: 'entry', entry: fragments[0]! });
    else if (fragments.length > 1) {
      const first = fragments[0]!;
      result.push({
        kind: 'entry',
        entry: { ...first, text: fragments.map((part) => part.text).join('') },
      });
    }
    fragments = [];
    streamId = undefined;
  };
  for (const entry of entries) {
    if (entry.kind === 'text' && entry.streamId) {
      if (streamId !== entry.streamId) flush();
      streamId = entry.streamId;
      fragments.push(entry);
      continue;
    }
    flush();
    if (entry.kind === 'tool_call') {
      const block = { kind: 'call' as const, call: entry, results: [] as ToolResult[] };
      if (entry.id) calls.set(entry.id, block);
      result.push(block);
    } else if (entry.kind === 'tool_result' && entry.id && calls.has(entry.id)) {
      calls.get(entry.id)?.results.push(entry);
    } else result.push({ kind: 'entry', entry });
  }
  flush();
  return result;
}
