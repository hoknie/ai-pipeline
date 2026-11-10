/** Longest text kept in one transcript entry; the rest is cut with a marker. */
export const TRANSCRIPT_TEXT_LIMIT = 20_000;

/** `at` is the moment (ms since epoch) the daemon received the log line the entry came from. */
export type TranscriptEntry =
  | {
      kind: 'text';
      text: string;
      /** Additive fragment identity, stable within one attempt; absent means a complete message. */
      streamId?: string | undefined;
      at?: number | null | undefined;
    }
  | {
      kind: 'tool_call';
      id: string | null;
      name: string;
      summary: string;
      input: string;
      at?: number | null | undefined;
    }
  | {
      kind: 'tool_result';
      id: string | null;
      text: string;
      error: boolean;
      at?: number | null | undefined;
    }
  | {
      kind: 'result';
      text: string | null;
      error: boolean;
      verdict: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
      costUsd: number | null;
      at?: number | null | undefined;
    }
  | { kind: 'raw'; text: string; at?: number | null | undefined };

export interface AgentTranscript {
  runId: string;
  group: string;
  seq: number | null;
  /** Number of log lines read; pass it back as `after` to get only new entries. */
  cursor: number;
  running: boolean;
  entries: TranscriptEntry[];
}

export function clip(text: string, limit = TRANSCRIPT_TEXT_LIMIT): string {
  return text.length > limit
    ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)`
    : text;
}
