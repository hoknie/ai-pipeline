import { clip, parseLogLine, toolCallEntry, type TranscriptEntry } from '../../types/index.ts';
import { codexEvent, type CodexItem } from './events.ts';

function itemEntries(item: CodexItem, completed: boolean, at: number | null): TranscriptEntry[] {
  const id = item.id ?? null;
  if (item.type === 'agent_message' && completed && item.text !== undefined) {
    return [{ kind: 'text', text: clip(item.text), at }];
  }
  if (item.type === 'command_execution') {
    if (!completed) return [toolCallEntry(id, 'Bash', { command: item.command }, null, at)];
    return [
      {
        kind: 'tool_result',
        id,
        text: clip(item.aggregated_output ?? ''),
        error: (item.exit_code ?? 0) !== 0,
        at,
      },
    ];
  }
  if (item.type === 'mcp_tool_call') {
    const name = `${item.server ?? 'mcp'}__${item.tool ?? 'tool'}`;
    if (!completed) return [toolCallEntry(id, name, item.arguments, null, at)];
    return [
      {
        kind: 'tool_result',
        id,
        text: clip(JSON.stringify(item.error ?? item.result ?? '')),
        error: (item.error !== undefined && item.error !== null) || item.status === 'failed',
        at,
      },
    ];
  }
  if (item.type === 'file_change' && completed) {
    return [toolCallEntry(id, 'Edit', item.changes, null, at)];
  }
  return [];
}

/** Readable `codex exec --json`; lines that are not an event of the CLI stay visible as raw. */
export function codexTranscript(lines: string[], times?: (number | null)[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const at = times?.[index] ?? null;
    const parsed = codexEvent.safeParse(parseLogLine(line));
    if (!parsed.success) {
      entries.push({ kind: 'raw', text: clip(line), at });
      continue;
    }
    const event = parsed.data;
    if (event.type === 'turn.completed') {
      entries.push({
        kind: 'result',
        text: null,
        error: false,
        verdict: null,
        inputTokens: event.usage?.input_tokens ?? null,
        outputTokens: event.usage?.output_tokens ?? null,
        at,
      });
    } else if (event.type === 'turn.failed' || event.type === 'error') {
      const text = event.type === 'error' ? event.message : event.error?.message;
      entries.push({
        kind: 'result',
        text: clip(text ?? 'error'),
        error: true,
        verdict: null,
        inputTokens: null,
        outputTokens: null,
        at,
      });
    } else if (
      event.type === 'item.started' ||
      event.type === 'item.updated' ||
      event.type === 'item.completed'
    ) {
      entries.push(...itemEntries(event.item, event.type === 'item.completed', at));
    }
  }
  return entries;
}
