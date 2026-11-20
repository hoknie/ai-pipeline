import type { DeliveryKind, DeliveryState, NotificationEventKind } from './index.ts';

/** The kind of the connection of a webhook. */
export const WEBHOOK_KIND = 'webhook';

/** The type of an event as the receiver sees it. */
export function webhookType(kind: DeliveryKind): string {
  switch (kind) {
    case 'question':
      return 'question.asked';
    case 'question_closed':
      return 'question.closed';
    case 'failed':
      return 'group.failed';
    case 'conflict':
      return 'group.conflict';
    case 'delivery':
      return 'delivery.failed';
    case 'finished':
      return 'task.finished';
    case 'test':
      return 'webhook.test';
  }
}

/** A webhook as the owner sees it: the address without its query, never the secret. */
export interface WebhookView {
  /** The id of the connection: every command of a webhook takes it. */
  id: string;
  name: string;
  /** Scheme, host, port and path. */
  url: string;
  /** Root of the project; null: every project. */
  project: string | null;
  events: NotificationEventKind[];
  enabled: boolean;
  /** The signing secret is set. */
  secret: boolean;
  /** Why the webhook switched itself off; null while nothing did. */
  disabledReason: string | null;
  /** Failed deliveries in a row. */
  failureStreak: number;
}

/** One attempt of a delivery. */
export interface WebhookAttemptView {
  n: number;
  at: number;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
  /** The first characters of the answer. */
  excerpt: string | null;
}

/** A line of the journal of a webhook with its attempts. */
export interface WebhookDeliveryView {
  id: number;
  /** The `webhook-id` the receiver sees. */
  webhookId: string;
  /** The type of the event, such as `question.asked`. */
  type: string;
  run: string;
  group: string | null;
  state: DeliveryState;
  attempts: WebhookAttemptView[];
  error: string | null;
  createdAt: number;
}

/** What one test call found. */
export interface WebhookTestView {
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  /** A fixed name of what went wrong; null when the receiver accepted the call. */
  error: string | null;
}
