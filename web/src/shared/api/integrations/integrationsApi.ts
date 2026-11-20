import type {
  ChannelStateView,
  ConnectionView,
  DeliveryView,
  IntegrationSenderView,
  IntegrationTypeView,
  RegistrySkillView,
  ProjectLinkView,
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

/** A new connection: its kind, name, scope and non-secret parameters. */
export interface NewConnection {
  kind: string;
  name: string;
  /** Root of one project; without it the connection is global. */
  repository?: string;
  params?: Record<string, string>;
}

export interface NewSubscription {
  connection: string;
  /** Root of one project; without it the subscription is for all projects. */
  repository?: string;
  events?: string[];
}

/** What is asked of the link of a project to a service registry: exactly one of the three. */
export type LinkAction = { path: string } | { auto: true } | { clear: true };

/** Connections, subscriptions and the journal. No secret travels through any of these calls. */
export interface IntegrationsApi {
  integrations(): Promise<IntegrationsOverview>;
  /** Changes non-secret parameters of a connection; a secret is set with the CLI only. */
  integrationEdit(
    id: string,
    change: { set?: Record<string, string>; unset?: string[] },
  ): Promise<ConnectionView>;
  /** Makes a connection; it stays off until its secrets are set (with the CLI). */
  integrationAdd(connection: NewConnection): Promise<ConnectionView>;
  integrationEnabled(id: string, enabled: boolean): Promise<ConnectionView>;
  integrationRemove(id: string): Promise<void>;
  /** Checks the connection; the outcome is kept in its `lastCheck`. */
  integrationCheck(id: string): Promise<ConnectionView>;
  /** The links of a project of a service registry (every project without a repository). */
  integrationLinks(repository?: string): Promise<ProjectLinkView[]>;
  /** Who wrote to the chat of a connection lately and is not allowed yet; empty for other kinds. */
  integrationSenders(id: string): Promise<IntegrationSenderView[]>;
  /** Links a project to a registry project, matches it again or clears the link. */
  integrationLink(id: string, repository: string, action: LinkAction): Promise<ProjectLinkView>;
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
    integrationAdd: ({ kind, name, repository, params }) =>
      post('/api/integrations', {
        kind,
        name,
        ...(repository === undefined ? { global: true } : { repository }),
        ...(params === undefined ? {} : { params }),
      }),
    integrationEnabled: (id, enabled) =>
      post(`/api/integrations/${enabled ? 'enable' : 'disable'}`, { id }),
    integrationRemove: async (id) => {
      await post('/api/integrations/remove', { id });
    },
    integrationCheck: (id) => post('/api/integrations/check', { id }),
    integrationEdit: (id, change) => post('/api/integrations/edit', { id, ...change }),
    integrationLinks: (repository) =>
      call(
        `/api/integrations/links${repository === undefined ? '' : `?repository=${encodeURIComponent(repository)}`}`,
      ),
    integrationSenders: (id) => call(`/api/integrations/senders?id=${enc(id)}`),
    integrationLink: (id, repository, action) =>
      post('/api/integrations/link', { id, repository, ...action }),
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
