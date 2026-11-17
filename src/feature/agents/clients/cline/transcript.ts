import { clip, parseLogLine, toolCallEntry, type TranscriptEntry } from '../../types/index.ts';
import { clineEvent, requestTokens } from './events.ts';

/** Readable Cline NDJSON; lines that are not its events stay visible as raw. */
export function clineTranscript(lines: string[], times?: (number | null)[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const at = times?.[index] ?? null;
    const parsed = clineEvent.safeParse(parseLogLine(line));
    if (!parsed.success) {
      entries.push({ kind: 'raw', text: clip(line), at });
      continue;
    }
    const event = parsed.data;
    if (requestTokens(event)) continue;
    if (event.say === 'text' || event.say === 'completion_result') {
      entries.push({ kind: 'text', text: clip(event.text ?? ''), at });
    } else if (event.say === 'command' || event.say === 'tool') {
      entries.push(
        toolCallEntry(
          event.id ?? null,
          event.say === 'command' ? 'Bash' : 'tool',
          {
            command: event.command ?? event.text,
          },
          null,
          at,
        ),
      );
    } else if (event.say === 'command_output' || event.say === 'tool_result') {
      entries.push({
        kind: 'tool_result',
        id: event.id ?? null,
        text: clip(event.text ?? ''),
        error: false,
        at,
      });
    } else if (event.say === 'error' || event.type === 'error') {
      entries.push({
        kind: 'result',
        text: clip(event.text ?? event.error ?? 'error'),
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
