import { z } from 'zod';

const usage = z.looseObject({
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
});

/**
 * The JSONL events of `copilot -p --output-format=json` aip reads. The CLI does not publish a stable
 * schema, so the shapes below are pinned by the fixtures of the tests and checked against the
 * installed version by hand; any other line is shown raw.
 */
export const copilotEvent = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('session.start'),
    data: z.looseObject({ sessionId: z.string() }),
  }),
  z.looseObject({
    type: z.literal('assistant.message'),
    data: z.looseObject({ content: z.string().optional() }),
  }),
  z.looseObject({ type: z.literal('assistant.usage'), data: usage }),
  z.looseObject({
    type: z.literal('tool.execution_start'),
    data: z.looseObject({
      toolCallId: z.string().optional(),
      toolName: z.string(),
      arguments: z.unknown().optional(),
    }),
  }),
  z.looseObject({
    type: z.literal('tool.execution_complete'),
    data: z.looseObject({
      toolCallId: z.string().optional(),
      success: z.boolean().optional(),
      result: z.unknown().optional(),
    }),
  }),
  z.looseObject({
    type: z.literal('session.error'),
    data: z.looseObject({ message: z.string().optional() }),
  }),
  z.looseObject({ type: z.literal('result'), exitCode: z.number().optional() }),
]);
export type CopilotEvent = z.infer<typeof copilotEvent>;
