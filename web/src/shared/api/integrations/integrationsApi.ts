import type {
  ChannelStateView,
  ConnectionView,
  DeliveryView,
  IntegrationTypeView,
  RegistrySkillView,
  SubscriptionView,
} from '../types.ts';
import { call, enc, post } from '../http.ts';

/** Everything the page of integrations shows at once. */
export interface IntegrationsOverview {
  connections: ConnectionView[];
  types: IntegrationTypeView[];
  subscriptions: SubscriptionView[];
  channels: ChannelStateView[];
}

export interface DeliveryQuery {
  subscription?: string;
  state?: string;
  limit?: number;
}

export interface NewSubscription {
  connection: string;
  /** Root of one project; without it the subscription is for all projects. */
  repository?: string;
  events?: string[];
}

/** Connections, subscriptions and the journal. No secret travels through any of these calls. */
export interface IntegrationsApi {
  integrations(): Promise<IntegrationsOverview>;
  /** Changes non-secret parameters of a connection; a secret is set with the CLI only. */
  integrationEdit(
    id: string,
    change: { set?: Record<string, string>; unset?: string[] },
  ): Promise<ConnectionView>;
  subscriptionAdd(subscription: NewSubscription): Promise<SubscriptionView>;
  subscriptionEvents(id: string, events: string[]): Promise<SubscriptionView>;
  subscriptionEnabled(id: string, enabled: boolean): Promise<SubscriptionView>;
  subscriptionRemove(id: string): Promise<void>;
  subscriptionTest(id: string): Promise<DeliveryView>;
  deliveries(query?: DeliveryQuery): Promise<DeliveryView[]>;
  /** The skills of the registry of the project this API is bound to, for the hints of the form. */
  registrySkills(query?: string): Promise<RegistrySkillView[]>;
}

export function integrationsApi(
  scoped: (path: string) => string = (path) => path,
): IntegrationsApi {
  return {
    registrySkills: (query) =>
      call(scoped(`/api/integrations/skills${query ? `?query=${enc(query)}` : ''}`)),
    integrations: () => call('/api/integrations'),
    integrationEdit: (id, change) => post('/api/integrations/edit', { id, ...change }),
    subscriptionAdd: (subscription) =>
      post('/api/notifications', {
        connection: subscription.connection,
        ...(subscription.repository === undefined
          ? { allProjects: true }
          : { repository: subscription.repository }),
        ...(subscription.events === undefined ? {} : { events: subscription.events }),
      }),
    subscriptionEvents: (id, events) => post('/api/notifications/edit', { id, events }),
    subscriptionEnabled: (id, enabled) =>
      post(`/api/notifications/${enabled ? 'enable' : 'disable'}`, { id }),
    subscriptionRemove: async (id) => {
      await post('/api/notifications/remove', { id });
    },
    subscriptionTest: (id) => post('/api/notifications/test', { id }),
    deliveries: (query = {}) => {
      const params = new URLSearchParams();
      if (query.subscription) params.set('subscription', query.subscription);
      if (query.state) params.set('state', query.state);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const search = params.toString();
      return call(`/api/notifications/log${search ? `?${search}` : ''}`);
    },
  };
}
