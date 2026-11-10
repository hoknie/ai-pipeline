import {
  clip,
  contentText,
  parseLogLine,
  toolCallEntry,
  type TranscriptEntry,
} from '../../types/index.ts';
import { agyEvent } from './events.ts';

/** Readable Antigravity NDJSON; unknown events and diagnostics remain visible as raw lines. */
export function agyTranscript(lines: string[], times?: (number | null)[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const calls = new Set<number>();
  const results = new Set<number>();
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const at = times?.[index] ?? null;
    const parsed = agyEvent.safeParse(parseLogLine(line));
    if (!parsed.success) {
      entries.push({ kind: 'raw', text: clip(line), at });
      continue;
    }
    const event = parsed.data;
    if (event.event === 'init') continue;
    if (event.event === 'result') {
      const result = event.result;
      entries.push({
        kind: 'result',
        text: clip(result.error ?? result.response ?? '') || null,
        error: result.status !== 'SUCCESS',
        verdict: null,
        inputTokens: result.usage?.input_tokens ?? null,
        outputTokens: result.usage?.output_tokens ?? null,
        costUsd: null,
        at,
      });
      continue;
    }
    const step = event.step_update;
    if (step.step_type === 'agent_response' && step.text_delta !== undefined) {
      entries.push({
        kind: 'text',
        text: clip(step.text_delta),
        streamId: `agy:agent-response:${step.step_index}`,
        at,
      });
    }
    if (step.step_type !== 'tool' || !step.tool_info) continue;
    const info = step.tool_info;
    const id = String(step.step_index);
    if (!calls.has(step.step_index)) {
      const parameters = info.parameters;
      entries.push(toolCallEntry(id, info.name ?? step.tool_name ?? 'tool', parameters, null, at));
      calls.add(step.step_index);
    }
    if (step.state === 'DONE' && !results.has(step.step_index)) {
      entries.push({
        kind: 'tool_result',
        id,
        text: clip(info.error?.message ?? contentText(info.output)),
        error: info.error !== undefined,
        at,
      });
      results.add(step.step_index);
    }
  }
  return entries;
}
