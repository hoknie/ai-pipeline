import { z } from 'zod';

/** One line of the headless JSON output of Cline; the fields aip does not read are ignored. */
export const clineEvent = z.looseObject({
  type: z.string(),
  say: z.string().optional(),
  ask: z.string().optional(),
  text: z.string().optional(),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  id: z.string().optional(),
  tool: z.string().optional(),
  command: z.string().optional(),
  error: z.string().optional(),
});
export type ClineEvent = z.infer<typeof clineEvent>;

const tokens = z.looseObject({
  tokensIn: z.number().nonnegative().optional(),
  tokensOut: z.number().nonnegative().optional(),
});

/** The request message (`api_req_started`) carries its token counts as JSON in `text`. */
export function requestTokens(event: ClineEvent): { input: number; output: number } | null {
  if (event.say !== 'api_req_started' || event.text === undefined) return null;
  try {
    const parsed = tokens.safeParse(JSON.parse(event.text));
    if (!parsed.success) return null;
    return { input: parsed.data.tokensIn ?? 0, output: parsed.data.tokensOut ?? 0 };
  } catch {
    return null;
  }
}

export function sessionOf(event: ClineEvent): string | null {
  return event.taskId ?? event.sessionId ?? null;
}
