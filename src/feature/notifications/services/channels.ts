import type { IntegrationsServices } from '../../integrations/services/index.ts';
import { isChatChannel } from './factories.ts';
import type { Connection, ConnectionChange } from '../../integrations/types/index.ts';
import { type NotificationsPublishPort, type OutboundChannelPort } from '../ports/index.ts';
import type {
  AttemptRepository,
  CursorRepository,
  DeliveryOutcomes,
  SubscriptionRepository,
} from '../repositories/index.ts';
import {
  CHAT_RETRY,
  CONNECTION_REMOVED,
  type RetryPolicy,
  type ChannelStatus,
  type InboundInput,
  type InboundResult,
  type Language,
} from '../types/index.ts';

import type { ChannelFactories } from './factories.ts';
import type { RecentSenders } from './senders/index.ts';

export interface ChannelsDependencies {
  integrations: IntegrationsServices;
  factories: ChannelFactories;
  cursors: CursorRepository;
  attempts: AttemptRepository;
  subscriptions: SubscriptionRepository;
  outcomes: DeliveryOutcomes;
  /** What the core does with what a chat sends. */
  handle: (connectionId: string, input: InboundInput) => Promise<InboundResult>;
  publish: NotificationsPublishPort;
  /** Who the channels saw writing; cleared when the connection is gone or its secret changes. */
  senders: RecentSenders;
  log: (message: string) => void;
  now: () => number;
  /** A connection was enabled or switched off: what the webhooks do about it. */
  settle?: (id: string, change: ConnectionChange) => void;
  /** The pause before a listener that stopped by itself is started again. */
  restartMs?: number;
}

/** A channel built from the parameters the connection has now. */
export interface OpenChannel {
  channel: OutboundChannelPort;
  connection: Connection;
  language: Language;
}

interface Listener {
  controller: AbortController;
  done: Promise<void>;
  finished: boolean;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * The channels of the connections: one listener per enabled connection of a channel kind,
 * whatever the number of subscriptions, started and stopped as the connection changes.
 */
export class NotificationChannels {
  private readonly dependencies: ChannelsDependencies;
  private readonly listeners = new Map<string, Listener>();
  private readonly states = new Map<string, ChannelStatus>();
  private stopping = false;
  /** The reactions to changes run one after another, so a quick change never overtakes the one before. */
  private chain: Promise<void> = Promise.resolve();

  constructor(dependencies: ChannelsDependencies) {
    this.dependencies = dependencies;
  }

  /** Starts a listener for every connection that can work now. */
  async start(): Promise<void> {
    this.stopping = false;
    for (const view of await this.dependencies.integrations.connections.list()) {
      this.sync(view.id);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.listeners.keys()].map((id) => this.halt(id)));
  }

  /** The kind of a connection; null when it cannot be found. */
  kindOf(connectionId: string): string | null {
    try {
      return this.dependencies.integrations.access.find(connectionId).kind;
    } catch {
      return null;
    }
  }

  /** The retries of the kind of a connection; those of a chat when it cannot be found. */
  policyOf(connectionId: string): RetryPolicy {
    const { integrations, factories } = this.dependencies;
    try {
      const { kind } = integrations.access.find(connectionId);
      return factories.get(kind)?.retry ?? CHAT_RETRY;
    } catch {
      return CHAT_RETRY;
    }
  }

  /** The channel of a connection with its parameters as they are now; null when it cannot work. */
  open(connectionId: string, options: { disabled?: boolean } = {}): OpenChannel | null {
    const { integrations, factories, cursors, attempts, senders, now } = this.dependencies;
    let connection: Connection;
    try {
      connection = integrations.access.find(connectionId);
      if (options.disabled === true) {
        if (connection.state !== 'ready') return null;
      } else {
        integrations.access.authorize(connectionId, connection.projectPath ?? '');
      }
    } catch {
      return null;
    }
    const factory = factories.get(connection.kind);
    if (factory === undefined || !integrations.access.complete(connection)) return null;
    const channel = factory.create({
      connection: {
        id: connection.id,
        name: connection.name,
        kind: connection.kind,
        params: connection.params,
      },
      now,
      seen: (person) => senders.note(connection.id, person, now()),
      record: (deliveryId, attempt) => attempts.insert(deliveryId, attempt),
      secret: (slot) => integrations.secrets.read(connection.id, slot).catch(() => null),
      cursor: {
        get: () => cursors.get(connection.id),
        set: (value) => cursors.set(connection.id, value, now()),
      },
    });
    return { channel, connection, language: factory.language(connection.params) };
  }

  statusOf(connectionId: string): ChannelStatus | null {
    return this.states.get(connectionId) ?? null;
  }

  connectionChanged(id: string, change: ConnectionChange): void {
    this.chain = this.chain
      .then(() => this.react(id, change))
      .catch((error: unknown) => {
        this.dependencies.log(`notifications: connection ${id}: ${String(error)}`);
      });
  }

  /** Resolves when every change heard so far has been dealt with. */
  settled(): Promise<void> {
    return this.chain;
  }

  private async react(id: string, change: ConnectionChange): Promise<void> {
    // Another bot or another workspace behind the connection: the people seen so far are not its.
    if (change === 'removed' || change === 'secret') this.dependencies.senders.clear(id);
    if (change === 'removed') {
      await this.halt(id);
      this.forget(id);
      return;
    }
    this.settle(id, change);
    // A change of the parameters, the secret or the state starts the listener again.
    await this.halt(id);
    if (change !== 'disabled') this.sync(id);
  }

  private settle(id: string, change: ConnectionChange): void {
    this.dependencies.settle?.(id, change);
  }

  /** The connection is gone: its subscriptions, waiting messages and read position go with it. */
  private forget(id: string): void {
    const { outcomes, subscriptions, cursors, publish, now } = this.dependencies;
    outcomes.closePendingOfConnection(id, CONNECTION_REMOVED, now());
    subscriptions.deleteOfConnection(id);
    cursors.delete(id);
    publish.subscriptionsChanged();
  }

  /** Starts the listener of a connection that can work and has none. */
  private sync(id: string): void {
    if (this.stopping) return;
    const running = this.listeners.get(id);
    if (running !== undefined && !running.finished) return;
    const opened = this.open(id);
    if (opened === null || !isChatChannel(opened.channel)) return;
    const controller = new AbortController();
    const listener: Listener = { controller, done: Promise.resolve(), finished: false };
    listener.done = this.loop(id, controller.signal).finally(() => {
      listener.finished = true;
    });
    this.listeners.set(id, listener);
  }

  private async halt(id: string): Promise<void> {
    const listener = this.listeners.get(id);
    this.listeners.delete(id);
    this.setStatus(id, null);
    if (listener === undefined) return;
    listener.controller.abort();
    await listener.done;
  }

  private async loop(id: string, signal: AbortSignal): Promise<void> {
    const { handle, log, restartMs } = this.dependencies;
    while (!signal.aborted) {
      const opened = this.open(id);
      if (opened === null || !isChatChannel(opened.channel)) return;
      let last: ChannelStatus | null = null;
      try {
        await opened.channel.listen({ handle: (input) => handle(id, input) }, signal, (status) => {
          last = status;
          if (!signal.aborted) this.setStatus(id, status);
        });
      } catch (error) {
        log(`notifications: listener of ${id} stopped: ${String(error)}`);
        if (!signal.aborted) {
          this.setStatus(id, { state: 'error', error: 'the channel stopped', unauthorized: false });
        }
      }
      if (signal.aborted) return;
      const status = last as ChannelStatus | null;
      // Rejected credentials stay rejected until the secret is replaced or the connection enabled again.
      if (status?.state === 'error' && status.unauthorized) return;
      await pause(restartMs ?? 5000, signal);
    }
  }

  private setStatus(id: string, status: ChannelStatus | null): void {
    if (status === null) this.states.delete(id);
    else this.states.set(id, status);
    this.dependencies.publish.channelChanged(id, status);
  }
}
