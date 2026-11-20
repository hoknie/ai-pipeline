import type { EventData, NotificationEventKind } from './events.ts';
import type { Closure } from './texts.ts';

export interface Subscription {
  id: string;
  connectionId: string;
  /** Root of the project; null: every project. */
  projectPath: string | null;
  events: NotificationEventKind[];
  enabled: boolean;
  /** Failed deliveries in a row; a sent one starts the count again. */
  failureStreak: number;
  /** Why the subscription switched its connection off; null while nothing did. */
  disabledReason: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A delivery is an event of a run or the test message of a subscription. */
export type DeliveryKind = NotificationEventKind | 'question_closed' | 'test';

export type DeliveryState = 'pending' | 'sent' | 'failed' | 'closed';
export const DELIVERY_STATES: readonly DeliveryState[] = ['pending', 'sent', 'failed', 'closed'];

export function isDeliveryState(value: string): value is DeliveryState {
  return (DELIVERY_STATES as readonly string[]).includes(value);
}

/** Where a sent message lives in the channel: the chat and the message, as the channel names them. */
export type ExternalRef = Record<string, string | number>;

export interface Delivery {
  id: number;
  shortKey: string;
  subscriptionId: string;
  eventKey: string;
  kind: DeliveryKind;
  run: string;
  group: string | null;
  questionKey: string | null;
  payload: EventData;
  state: DeliveryState;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  external: ExternalRef | null;
  /** Who closed the question: set before the message is updated, kept after. */
  closedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Marks of a delivery closed without a message to update. */
export const BEFORE_SUBSCRIPTION = 'before_subscription';
export const CONNECTION_REMOVED = 'connection_removed';

export function encodeClosure(closure: Closure): string {
  return JSON.stringify(closure);
}

/** The closure a delivery records; a service mark or garbage reads as `other`. */
export function decodeClosure(value: string | null): Closure {
  if (value === null) return { by: 'other' };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.by === 'channel' && typeof parsed.channel === 'string') {
      return { by: 'channel', channel: parsed.channel, user: String(parsed.user ?? '') };
    }
    if (['human', 'autopilot', 'observer', 'cancelled', 'other'].includes(String(parsed.by))) {
      return { by: parsed.by as 'human' };
    }
  } catch {
    // a service mark such as `before_subscription`
  }
  return { by: 'other' };
}

/** A line of the journal as the owner sees it. */
export interface DeliveryView {
  id: number;
  subscription: string;
  event: string;
  kind: DeliveryKind;
  run: string;
  group: string | null;
  state: DeliveryState;
  attempts: number;
  lastAttemptAt: number;
  error: string | null;
  createdAt: number;
}

export interface Draft {
  index: number;
  answer: string;
}

export interface SubscriptionView {
  id: string;
  connection: string;
  connectionName: string;
  kind: string;
  /** Root of the project; null: every project. */
  project: string | null;
  events: NotificationEventKind[];
  enabled: boolean;
}

/** What a channel reports of one attempt to send a delivery. */
export interface AttemptRecord {
  startedAt: number;
  durationMs: number;
  /** The status of the answer; null when none came. */
  statusCode: number | null;
  /** A fixed name of what went wrong; null for an accepted attempt. */
  errorKind: string | null;
  /** The first characters of the answer, as text. */
  excerpt: string | null;
}

export interface Attempt extends AttemptRecord {
  deliveryId: number;
  n: number;
}
