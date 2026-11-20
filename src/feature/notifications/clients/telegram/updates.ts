import { z } from 'zod';

const user = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});
const chat = z.object({ id: z.number().int() });

const message = z.object({
  message_id: z.number().int(),
  chat,
  from: user.optional(),
  text: z.string().optional(),
  reply_to_message: z
    .object({ message_id: z.number().int(), text: z.string().optional(), from: user.optional() })
    .optional(),
});

const callback = z.object({
  id: z.string(),
  from: user,
  message: z.object({ message_id: z.number().int(), chat }).optional(),
  data: z.string().optional(),
});

/** An update of `getUpdates`, as far as the daemon looks at it; everything else is dropped. */
export const updateSchema = z.object({
  update_id: z.number().int(),
  message: message.optional(),
  callback_query: callback.optional(),
});

export type TelegramUpdate = z.infer<typeof updateSchema>;

/**
 * The updates of one answer. One that does not fit the schema is skipped, but its id still moves the
 * read position forward, so it is not asked for again.
 */
export function parseUpdates(result: unknown): { updates: TelegramUpdate[]; last: number | null } {
  if (!Array.isArray(result)) return { updates: [], last: null };
  const updates: TelegramUpdate[] = [];
  let last: number | null = null;
  for (const item of result) {
    const id = (item as { update_id?: unknown } | null)?.update_id;
    if (typeof id === 'number' && Number.isInteger(id)) last = Math.max(last ?? id, id);
    const parsed = updateSchema.safeParse(item);
    if (parsed.success) updates.push(parsed.data);
  }
  return { updates, last };
}

/** The short key a prompt of the bot carries in its text: `#ABCDEFGHIJ`. */
export function shortKeyOfPrompt(text: string | undefined): string | null {
  return /#([A-Z2-7]{10})\b/.exec(text ?? '')?.[1] ?? null;
}

/** `/id` and `/id@botname` ask for the ids; every other command is ignored. */
export function isIdCommand(text: string): boolean {
  return /^\/id(@\w+)?(\s|$)/i.test(text.trim());
}

export function isCommand(text: string): boolean {
  return text.trim().startsWith('/');
}

/** A person of Telegram as a panel shows them: `@username`, else the first and the last name. */
export function personOf(from: z.infer<typeof user>): { user: string; label: string | null } {
  const name = [from.first_name, from.last_name].filter((one) => one !== undefined && one !== '');
  const label = from.username ? `@${from.username}` : name.join(' ');
  return { user: String(from.id), label: label === '' ? null : label };
}

/** Whether the sender is a person: a bot is never offered as a user to allow. */
export function isPerson(from: z.infer<typeof user> | undefined): from is z.infer<typeof user> {
  return from !== undefined && from.is_bot !== true;
}
