import { z } from 'zod';

import { DELIVERY_STATES } from '../../../../feature/notifications/types/index.ts';
import { queueRepository } from '../queue.ts';

export type {
  ChannelStatus as ChannelStatusView,
  DeliveryView,
  SubscriptionView,
} from '../../../../feature/notifications/types/index.ts';

/** The answer of `notify_remove`. */
export interface NotificationRemoved {
  removed: string;
}

/** The state of the channel of one connection. */
export interface ChannelStateView {
  connection: string;
  state: 'listening' | 'error';
  /** A safe text of the error; null while listening. */
  error: string | null;
  unauthorized: boolean;
}

const subscriptionId = z.string().min(1).max(64);
const events = z.array(z.string().min(1).max(40)).max(20);

/**
 * The methods of the subscriptions to notifications. None of them takes or returns a secret; the
 * local CLI and the panel use them, and no MCP tool carries them.
 */
export const notificationsRequests = [
  z.object({
    method: z.literal('notify_list'),
    params: z.object({ repository: queueRepository.optional() }).default({}),
  }),
  z.object({
    method: z.literal('notify_add'),
    params: z.object({
      connection: z.string().min(1).max(64),
      repository: queueRepository.optional(),
      allProjects: z.boolean().optional(),
      events: events.optional(),
    }),
  }),
  z.object({
    method: z.literal('notify_edit'),
    params: z.object({ id: subscriptionId, events }),
  }),
  z.object({ method: z.literal('notify_enable'), params: z.object({ id: subscriptionId }) }),
  z.object({ method: z.literal('notify_disable'), params: z.object({ id: subscriptionId }) }),
  z.object({ method: z.literal('notify_remove'), params: z.object({ id: subscriptionId }) }),
  z.object({ method: z.literal('notify_test'), params: z.object({ id: subscriptionId }) }),
  z.object({
    method: z.literal('notify_log'),
    params: z
      .object({
        subscription: subscriptionId.optional(),
        state: z.enum(DELIVERY_STATES as [string, ...string[]]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .default({}),
  }),
  z.object({ method: z.literal('notify_channels'), params: z.object({}).default({}) }),
] as const;
