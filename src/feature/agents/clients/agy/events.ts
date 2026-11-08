import { z } from 'zod';

const tokens = z.looseObject({
  input_tokens: z.number().nonnegative().optional(),
  output_tokens: z.number().nonnegative().optional(),
});

export const agyStep = z.looseObject({
  conversation_id: z.string().optional(),
  step_index: z.number().int(),
  state: z.string(),
  step_type: z.string(),
  text_delta: z.string().optional(),
  tool_name: z.string().optional(),
  tool_info: z
    .looseObject({
      name: z.string().optional(),
      parameters: z.unknown().optional(),
      output: z.unknown().optional(),
      error: z.looseObject({ message: z.string().optional() }).optional(),
    })
    .optional(),
  usage: tokens.optional(),
});

export const agyResult = z.looseObject({
  conversation_id: z.string().optional(),
  status: z.string(),
  response: z.string().optional(),
  error: z.string().optional(),
  num_turns: z.number().optional(),
  usage: tokens.optional(),
});

export const agyEvent = z.discriminatedUnion('event', [
  z.looseObject({ event: z.literal('init'), conversation_id: z.string() }),
  z.looseObject({ event: z.literal('step_update'), step_update: agyStep }),
  z.looseObject({ event: z.literal('result'), result: agyResult }),
]);
