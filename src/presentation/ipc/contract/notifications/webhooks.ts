import { z } from 'zod';

import { DELIVERY_STATES } from '../../../../feature/notifications/types/index.ts';

import { queueRepository } from '../queue.ts';

export type {
  WebhookAttemptView,
  WebhookDeliveryView,
  WebhookTestView,
  WebhookView,
} from '../../../../feature/notifications/types/index.ts';

/** The answer of `webhook_remove`. */
export interface WebhookRemoved {
  removed: string;
}

const connectionId = z.string().min(1).max(64);
const events = z.array(z.string().min(1).max(40)).max(20);
const url = z.string().min(1).max(2048);

/**
 * The methods of outgoing webhooks. Every `id` is the id of the connection of the webhook, except
 * the one of `webhook_redeliver`, which is the id of a delivery. None takes or returns a secret or
 * the query of an address.
 */
export const webhooksRequests = [
  z.object({
    method: z.literal('webhook_list'),
    params: z.object({ repository: queueRepository.optional() }).default({}),
  }),
  z.object({
    method: z.literal('webhook_add'),
    params: z.object({
      name: z.string().min(1).max(64),
      url,
      repository: queueRepository.optional(),
      allProjects: z.boolean().optional(),
      events: events.optional(),
    }),
  }),
  z.object({
    method: z.literal('webhook_edit'),
    params: z.object({ id: connectionId, url: url.optional(), events: events.optional() }),
  }),
  z.object({ method: z.literal('webhook_enable'), params: z.object({ id: connectionId }) }),
  z.object({ method: z.literal('webhook_disable'), params: z.object({ id: connectionId }) }),
  z.object({ method: z.literal('webhook_remove'), params: z.object({ id: connectionId }) }),
  z.object({ method: z.literal('webhook_test'), params: z.object({ id: connectionId }) }),
  z.object({
    method: z.literal('webhook_log'),
    params: z.object({
      id: connectionId,
      state: z.enum(DELIVERY_STATES as [string, ...string[]]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
  }),
  z.object({
    method: z.literal('webhook_redeliver'),
    params: z.object({ id: z.number().int().min(1) }),
  }),
] as const;
