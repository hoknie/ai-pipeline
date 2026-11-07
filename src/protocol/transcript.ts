import { z } from 'zod';

export { TRANSCRIPT_TEXT_LIMIT, clip } from '../feature/agents/types/index.ts';

/** Moment (ms since epoch) the daemon received the log line the entry came from. */
const at = z.number().nullable().optional();

export const transcriptEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string(), at }),
  z.object({
    kind: z.literal('tool_call'),
    id: z.string().nullable(),
    name: z.string(),
    summary: z.string(),
    input: z.string(),
    at,
  }),
  z.object({
    kind: z.literal('tool_result'),
    id: z.string().nullable(),
    text: z.string(),
    error: z.boolean(),
    at,
  }),
  z.object({
    kind: z.literal('result'),
    text: z.string().nullable(),
    error: z.boolean(),
    verdict: z.string().nullable(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    costUsd: z.number().nullable(),
    at,
  }),
  z.object({ kind: z.literal('raw'), text: z.string(), at }),
]);

export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

export const transcriptSchema = z.object({
  runId: z.string(),
  group: z.string(),
  seq: z.number().nullable(),
  /** Number of log lines read; pass it back as `after` to get only new entries. */
  cursor: z.number(),
  running: z.boolean(),
  entries: z.array(transcriptEntrySchema),
});

export type Transcript = z.infer<typeof transcriptSchema>;
