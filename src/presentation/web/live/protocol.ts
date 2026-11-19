import { z } from 'zod';

import { renderPanelError } from '../errors.ts';

/** The longest message a client may send, in bytes. */
export const MAX_MESSAGE_BYTES = 4 * 1024;
/** How many subscriptions one connection may hold. */
export const MAX_SUBSCRIPTIONS = 64;

const id = z.string().min(1).max(128);
const target = { runId: z.string().min(1).max(128), group: z.string().min(1).max(256) };

export const topicSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('transcript'),
    ...target,
    seq: z.number().int().positive(),
    after: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({ kind: z.literal('group'), ...target }),
  z.strictObject({
    kind: z.literal('group_spec'),
    ...target,
    /** Read again when the log of the group grows, not only when the run changes. */
    watch: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('providers'),
    repository: z.string().min(1).max(4096).optional(),
    level: z.literal('global').optional(),
  }),
]);

export type Topic = z.infer<typeof topicSchema>;
export type TranscriptTopic = Extract<Topic, { kind: 'transcript' }>;
export type StateTopic = Exclude<Topic, { kind: 'transcript' }>;

export const clientMessageSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('subscribe'), id, topic: topicSchema }),
  z.strictObject({ op: z.literal('unsubscribe'), id }),
  /** Read the data of the subscription again now. */
  z.strictObject({ op: z.literal('refresh'), id }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** What the server says about a subscription. */
export type TopicMessage =
  | { event: 'topic'; id: string; data: unknown }
  | { event: 'topic_error'; id: string; error: string; code?: string };

/** The id a refused message names, when it has one. */
function idOf(raw: unknown): string {
  const given = (raw as { id?: unknown } | null)?.id;
  return typeof given === 'string' ? given.slice(0, 128) : '';
}

/** A message of a client, or the refusal to send back; the input is never quoted. */
export function parseClientMessage(text: string): ClientMessage | TopicMessage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      event: 'topic_error',
      id: '',
      error: 'message is not valid JSON',
      code: 'live.invalid',
    };
  }
  const parsed = clientMessageSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { event: 'topic_error', id: idOf(raw), error: 'invalid message', code: 'live.invalid' };
}

/** One connection as the subscriptions see it. */
export interface LiveClient {
  send(message: TopicMessage): void;
  /** The user the reads are made for; undefined for the local panel. */
  actor: string | undefined;
}

/** Reads the data of a topic from the daemon, for the user of the connection. */
export type ReadTopic = (topic: Topic, actor: string | undefined) => Promise<unknown>;

/** An event of the daemon the topics react to. */
export type TopicSignal =
  { event: 'run'; runId: string } | { event: 'log'; runId: string; group: string; attempt: number };

export function topicError(id: string, error: unknown): TopicMessage {
  const { body } = renderPanelError(error);
  return {
    event: 'topic_error',
    id,
    error: body.error,
    ...(body.code === undefined ? {} : { code: body.code }),
  };
}

/** A subscription a connection holds: how to read its topic again and how to drop it. */
export interface Held {
  stop(): void;
  refresh(): void;
}
