import {
  clip,
  contentText,
  parseLogLine,
  toolCallEntry,
  type TranscriptEntry,
} from '../../types/index.ts';
import { copilotEvent } from './events.ts';

/** Readable Copilot JSONL; lines that are not its events stay visible as raw. */
export function copilotTranscript(lines: string[], times?: (number | null)[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const at = times?.[index] ?? null;
    const parsed = copilotEvent.safeParse(parseLogLine(line));
    if (!parsed.success) {
      entries.push({ kind: 'raw', text: clip(line), at });
      continue;
    }
    const event = parsed.data;
    if (event.type === 'assistant.message' && event.data.content) {
      entries.push({ kind: 'text', text: clip(event.data.content), at });
    } else if (event.type === 'tool.execution_start') {
      entries.push(
        toolCallEntry(event.data.toolCallId, event.data.toolName, event.data.arguments, null, at),
      );
    } else if (event.type === 'tool.execution_complete') {
      entries.push({
        kind: 'tool_result',
        id: event.data.toolCallId ?? null,
        text: clip(contentText(event.data.result)),
        error: event.data.success === false,
        at,
      });
    } else if (event.type === 'session.error') {
      entries.push({
        kind: 'result',
        text: clip(event.data.message ?? 'error'),
        error: true,
        verdict: null,
        inputTokens: null,
        outputTokens: null,
        at,
      });
    }
  }
  return entries;
}
