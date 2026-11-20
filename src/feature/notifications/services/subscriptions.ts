import { randomBytes } from 'node:crypto';

import type { IntegrationsServices } from '../../integrations/services/index.ts';
import type { Connection } from '../../integrations/types/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { NotificationsPublishPort } from '../ports/index.ts';
import type { DeliveryRepository, SubscriptionRepository } from '../repositories/index.ts';
import {
  BEFORE_SUBSCRIPTION,
  DEFAULT_EVENTS,
  EVENT_KINDS,
  isEventKind,
  notificationRefusal,
  type NotificationEvent,
  type NotificationEventKind,
  type Subscription,
  type SubscriptionView,
} from '../types/index.ts';

import type { ChannelFactories } from './factories.ts';

export interface SubscriptionDependencies {
  subscriptions: SubscriptionRepository;
  deliveries: DeliveryRepository;
  integrations: IntegrationsServices;
  registry: RegistryService;
  factories: ChannelFactories;
  /** The events the runs hold now; the ones from before a subscription are not sent. */
  events: () => NotificationEvent[];
  /** A subscription changed: the dispatcher looks at the open questions again. */
  changed: () => void;
  publish: NotificationsPublishPort;
  now: () => number;
}

export interface NewSubscription {
  /** The id of the connection. */
  connection: string;
  /** A project reference (path or slug); absent with `allProjects`. */
  repository?: string | undefined;
  allProjects?: boolean | undefined;
  events?: readonly string[] | undefined;
}

/** The kinds in the order of the table, without repeats; a wrong name is refused. */
export function checkedEvents(names: readonly string[]): NotificationEventKind[] {
  if (names.length === 0) throw notificationRefusal('no_events');
  if (!names.every(isEventKind)) throw notificationRefusal('unknown_event');
  const chosen = new Set<string>(names);
  return EVENT_KINDS.filter((kind) => chosen.has(kind));
}

export function subscribes(subscription: Subscription, event: NotificationEvent): boolean {
  return (
    subscription.enabled &&
    subscription.events.includes(event.kind) &&
    (subscription.projectPath === null || subscription.projectPath === event.repository)
  );
}

/** The subscriptions of connections to the events of projects. */
export class SubscriptionService {
  private readonly dependencies: SubscriptionDependencies;

  constructor(dependencies: SubscriptionDependencies) {
    this.dependencies = dependencies;
  }

  /** Every subscription, or those that serve a project. */
  async list(repository?: string): Promise<SubscriptionView[]> {
    const root = repository === undefined ? undefined : await this.projectOf(repository);
    return this.dependencies.subscriptions
      .all()
      .filter((one) => root === undefined || one.projectPath === null || one.projectPath === root)
      .map((one) => this.view(one));
  }

  async add(request: NewSubscription): Promise<SubscriptionView> {
    const { subscriptions, now, integrations } = this.dependencies;
    const connection = integrations.access.find(request.connection);
    this.requireChannel(connection);
    if ((request.allProjects === true) === (request.repository !== undefined)) {
      throw notificationRefusal('scope_required');
    }
    const projectPath =
      request.allProjects === true ? null : await this.projectOf(request.repository ?? '');
    if (connection.scope === 'project' && connection.projectPath !== projectPath) {
      throw notificationRefusal('scope_denied');
    }
    const events =
      request.events === undefined ? [...DEFAULT_EVENTS] : checkedEvents(request.events);
    if (
      !connection.enabled ||
      connection.state !== 'ready' ||
      !integrations.access.complete(connection)
    ) {
      throw notificationRefusal('connection_disabled');
    }
    this.requireTarget(connection);
    const subscription: Subscription = {
      id: `n${randomBytes(6).toString('hex')}`,
      connectionId: connection.id,
      projectPath,
      events,
      enabled: true,
      createdAt: now(),
      updatedAt: now(),
    };
    subscriptions.insert(subscription);
    this.closeExisting(subscription, events);
    return this.changed(subscription.id);
  }

  async edit(id: string, names: readonly string[]): Promise<SubscriptionView> {
    const { subscriptions, now } = this.dependencies;
    const subscription = this.find(id);
    const events = checkedEvents(names);
    subscriptions.setEvents(id, events, now());
    this.closeExisting(
      { ...subscription, events },
      events.filter((kind) => !subscription.events.includes(kind)),
    );
    return this.changed(id);
  }

  enable(id: string): SubscriptionView {
    const { subscriptions, now, integrations } = this.dependencies;
    const subscription = this.find(id);
    this.requireTarget(integrations.access.find(subscription.connectionId));
    if (!subscription.enabled) {
      subscriptions.setEnabled(id, true, now());
      // What happened while it was off is not sent.
      this.closeExisting({ ...subscription, enabled: true }, subscription.events);
    }
    return this.changed(id);
  }

  disable(id: string): SubscriptionView {
    this.find(id);
    this.dependencies.subscriptions.setEnabled(id, false, this.dependencies.now());
    return this.changed(id);
  }

  remove(id: string): void {
    this.find(id);
    this.dependencies.subscriptions.delete(id);
    this.dependencies.publish.subscriptionsChanged();
  }

  find(id: string): Subscription {
    const subscription = this.dependencies.subscriptions.find(id);
    if (subscription === undefined) throw notificationRefusal('not_found');
    return subscription;
  }

  /** The enabled subscriptions that want the event. */
  matching(event: NotificationEvent): Subscription[] {
    return this.dependencies.subscriptions.all().filter((one) => subscribes(one, event));
  }

  all(): Subscription[] {
    return this.dependencies.subscriptions.all();
  }

  /** One statement: part of the transaction that moves a project. */
  moveProject(from: string, to: string): void {
    this.dependencies.subscriptions.moveProject(from, to);
  }

  /** One statement: part of the transaction that forgets a project. */
  forgetProject(root: string): void {
    this.dependencies.subscriptions.deleteOfProject(root);
  }

  view(subscription: Subscription): SubscriptionView {
    let connection: Connection | undefined;
    try {
      connection = this.dependencies.integrations.access.find(subscription.connectionId);
    } catch {
      connection = undefined;
    }
    return {
      id: subscription.id,
      connection: subscription.connectionId,
      connectionName: connection?.name ?? '',
      kind: connection?.kind ?? '',
      project: subscription.projectPath,
      events: subscription.events,
      enabled: subscription.enabled,
    };
  }

  private changed(id: string): SubscriptionView {
    const view = this.view(this.find(id));
    this.dependencies.publish.subscriptionsChanged();
    this.dependencies.changed();
    return view;
  }

  private requireChannel(connection: Connection): void {
    if (!this.dependencies.factories.has(connection.kind)) {
      throw notificationRefusal('not_a_channel');
    }
  }

  /** A subscription is refused while the connection lacks what the channel needs to write. */
  private requireTarget(connection: Connection): void {
    this.requireChannel(connection);
    const missing = this.dependencies.factories
      .get(connection.kind)
      ?.missingForSubscription(connection.params);
    if (missing !== null && missing !== undefined) {
      throw notificationRefusal('missing_param', missing);
    }
  }

  /** Records the events that already happened as closed: only open questions are still sent. */
  private closeExisting(subscription: Subscription, kinds: readonly NotificationEventKind[]): void {
    const { deliveries, events, now } = this.dependencies;
    for (const event of events()) {
      if (event.kind === 'question' || !kinds.includes(event.kind)) continue;
      if (!subscribes(subscription, event)) continue;
      deliveries.claim(
        {
          subscriptionId: subscription.id,
          eventKey: event.key,
          kind: event.kind,
          run: event.run,
          group: event.group,
          questionKey: null,
          payload: event.data,
          closedBy: BEFORE_SUBSCRIPTION,
        },
        now(),
      );
    }
  }

  private async projectOf(reference: string): Promise<string> {
    try {
      return await this.dependencies.registry.resolve(reference);
    } catch {
      throw notificationRefusal('unknown_project');
    }
  }
}
