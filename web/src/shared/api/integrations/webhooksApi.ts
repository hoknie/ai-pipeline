import type { WebhookDeliveryView, WebhookTestView, WebhookView } from '../types.ts';
import { call, post } from '../http.ts';

export interface NewWebhook {
  name: string;
  url: string;
  /** Root of one project; without it the webhook is for all projects. */
  repository?: string;
  events?: string[];
}

/** Webhooks and their journal. The signing secret travels through none of these calls. */
export interface WebhooksApi {
  webhooks(): Promise<WebhookView[]>;
  webhookAdd(webhook: NewWebhook): Promise<WebhookView>;
  webhookEdit(id: string, change: { url?: string; events?: string[] }): Promise<WebhookView>;
  webhookEnabled(id: string, enabled: boolean): Promise<WebhookView>;
  webhookRemove(id: string): Promise<void>;
  webhookTest(id: string): Promise<WebhookTestView>;
  webhookLog(id: string, limit?: number): Promise<WebhookDeliveryView[]>;
  webhookRedeliver(delivery: number): Promise<WebhookDeliveryView>;
}

export function webhooksApi(): WebhooksApi {
  return {
    webhooks: () => call('/api/webhooks'),
    webhookAdd: (webhook) =>
      post('/api/webhooks', {
        name: webhook.name,
        url: webhook.url,
        ...(webhook.repository === undefined
          ? { allProjects: true }
          : { repository: webhook.repository }),
        ...(webhook.events === undefined ? {} : { events: webhook.events }),
      }),
    webhookEdit: (id, change) => post('/api/webhooks/edit', { id, ...change }),
    webhookEnabled: (id, enabled) =>
      post(`/api/webhooks/${enabled ? 'enable' : 'disable'}`, { id }),
    webhookRemove: async (id) => {
      await post('/api/webhooks/remove', { id });
    },
    webhookTest: (id) => post('/api/webhooks/test', { id }),
    webhookLog: (id, limit = 20) =>
      call(`/api/webhooks/log?${new URLSearchParams({ id, limit: String(limit) }).toString()}`),
    webhookRedeliver: (delivery) => post('/api/webhooks/redeliver', { id: delivery }),
  };
}
