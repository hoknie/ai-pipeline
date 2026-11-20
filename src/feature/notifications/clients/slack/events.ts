import { z } from 'zod';

const clicked = z.object({
  action_id: z.string(),
  action_ts: z.string().optional(),
  value: z.string().optional(),
  selected_option: z.object({ value: z.string() }).optional(),
});

const interactive = z.object({
  type: z.literal('block_actions'),
  user: z.object({ id: z.string() }),
  team: z.object({ id: z.string() }).optional(),
  channel: z.object({ id: z.string() }).optional(),
  container: z.object({ channel_id: z.string().optional() }).optional(),
  message: z.object({ ts: z.string(), thread_ts: z.string().optional() }).optional(),
  actions: z.array(clicked).min(1),
});

const message = z.object({
  type: z.literal('message'),
  channel: z.string(),
  user: z.string().optional(),
  text: z.string().optional(),
  ts: z.string(),
  thread_ts: z.string().optional(),
  bot_id: z.string().optional(),
  subtype: z.string().optional(),
});

const eventsApi = z.object({
  team_id: z.string().optional(),
  event: z.object({ type: z.string() }).passthrough(),
});

const envelope = z.object({
  type: z.string(),
  envelope_id: z.string().optional(),
  reason: z.string().optional(),
  payload: z.unknown().optional(),
});

/** What a message of Socket Mode is, as far as the daemon looks at it. */
export type SlackEnvelope =
  | { type: 'hello' }
  | { type: 'disconnect'; reason: string }
  | {
      type: 'click';
      envelopeId: string;
      team: string | null;
      channel: string;
      user: string;
      /** The message with the button: its `ts`, and the thread it belongs to. */
      message: { ts: string; thread: string } | null;
      actionId: string;
      actionTs: string | null;
      selected: string | null;
    }
  | {
      type: 'reply';
      envelopeId: string;
      team: string | null;
      channel: string;
      user: string;
      text: string;
      ts: string;
      thread: string;
    }
  /** Anything else: it is acknowledged when it has an id, and ignored. */
  | { type: 'other'; envelopeId: string | null };

/** Reads one text message of the socket; null when it is not JSON of the protocol. */
export function parseEnvelope(raw: string): SlackEnvelope | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const head = envelope.safeParse(json);
  if (!head.success) return null;
  const { type, envelope_id: id, reason, payload } = head.data;
  if (type === 'hello') return { type: 'hello' };
  if (type === 'disconnect') return { type: 'disconnect', reason: reason ?? '' };
  const other: SlackEnvelope = { type: 'other', envelopeId: id ?? null };
  if (id === undefined) return other;
  if (type === 'interactive') {
    const parsed = interactive.safeParse(payload);
    if (!parsed.success) return other;
    const { user, team, channel, container, message: sent, actions } = parsed.data;
    const where = channel?.id ?? container?.channel_id;
    const action = actions[0]!;
    if (where === undefined) return other;
    return {
      type: 'click',
      envelopeId: id,
      team: team?.id ?? null,
      channel: where,
      user: user.id,
      message: sent === undefined ? null : { ts: sent.ts, thread: sent.thread_ts ?? sent.ts },
      actionId: action.action_id,
      actionTs: action.action_ts ?? null,
      selected: action.selected_option?.value ?? null,
    };
  }
  if (type === 'events_api') {
    const api = eventsApi.safeParse(payload);
    const event = api.success ? message.safeParse(api.data.event) : null;
    if (!api.success || event === null || !event.success) return other;
    const { channel, user, text, ts, thread_ts: thread, bot_id: bot, subtype } = event.data;
    // Bots (this one too), edits, deletions, and anything outside a thread tell nothing to answer.
    if (bot !== undefined || subtype !== undefined || user === undefined) return other;
    if (thread === undefined || thread === ts) return other;
    return {
      type: 'reply',
      envelopeId: id,
      team: api.data.team_id ?? null,
      channel,
      user,
      text: text ?? '',
      ts,
      thread,
    };
  }
  return other;
}

/** The action of the core a button or an option of a list stands for; null for a foreign element. */
export function actionOf(
  actionId: string,
  selected: string | null,
): { shortKey: string; action: string } | null {
  const match = /^([A-Z2-7]{10}):(.+)$/.exec(actionId);
  if (match === null) return null;
  const [, shortKey, rest] = match as unknown as [string, string, string];
  // A list carries the question in its id and the variant in the chosen option.
  const action = /^o:\d+$/.test(rest) && selected !== null ? `${rest}:${selected}` : rest;
  return /^(o:\d+:\d+|r|c|a|f)$/.test(action) ? { shortKey, action } : null;
}
