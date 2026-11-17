import { z } from 'zod';

const usage = z.looseObject({
  input_tokens: z.number().nonnegative().optional(),
  output_tokens: z.number().nonnegative().optional(),
});

const item = z.looseObject({
  id: z.string().optional(),
  type: z.string(),
  text: z.string().optional(),
  command: z.string().optional(),
  aggregated_output: z.string().optional(),
  exit_code: z.number().nullable().optional(),
  status: z.string().optional(),
  server: z.string().optional(),
  tool: z.string().optional(),
  arguments: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
  changes: z.unknown().optional(),
});

/** The `codex exec --json` events aip reads; anything else is shown raw. */
export const codexEvent = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('thread.started'), thread_id: z.string() }),
  z.looseObject({ type: z.literal('turn.started') }),
  z.looseObject({ type: z.literal('turn.completed'), usage: usage.optional() }),
  z.looseObject({
    type: z.literal('turn.failed'),
    error: z.looseObject({ message: z.string().optional() }).optional(),
  }),
  z.looseObject({ type: z.literal('error'), message: z.string().optional() }),
  z.looseObject({ type: z.literal('item.started'), item }),
  z.looseObject({ type: z.literal('item.updated'), item }),
  z.looseObject({ type: z.literal('item.completed'), item }),
]);

export type CodexEvent = z.infer<typeof codexEvent>;
export type CodexItem = z.infer<typeof item>;
