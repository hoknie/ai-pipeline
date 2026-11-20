import type { IntegrationAdapterPort } from '../../../src/feature/integrations/ports/index.ts';
import type { AdapterDescriptor } from '../../../src/feature/integrations/types/index.ts';
import type {
  ChannelFactoryPort,
  ChannelOptions,
  ChatChannelPort,
  InboundHandler,
  OutboundMessage,
} from '../../../src/feature/notifications/ports/index.ts';
import {
  ChannelFailure,
  type ChannelStatus,
  type ChatMessage,
  type Draw,
  DEFAULT_LIMITS,
  type EventData,
  type ExternalRef,
  type NotificationEvent,
} from '../../../src/feature/notifications/types/index.ts';

import {
  webhookAdapter,
  webhookChannelFactory,
} from '../../../src/feature/notifications/clients/index.ts';
import type { WebhookFactoryOptions } from '../../../src/feature/notifications/clients/webhook/channel.ts';

import { fixture, type Fixture } from '../integrations/helpers.ts';

export const CHAT: AdapterDescriptor = {
  kind: 'chat',
  title: 'Chat',
  params: [
    { name: 'chat_id', required: false, maxLength: 20 },
    { name: 'allowed_users', required: false, maxLength: 100 },
    { name: 'language', required: false, maxLength: 2, values: ['en', 'ru'] },
  ],
  secrets: [{ slot: 'token', required: true }],
  directions: ['inbound', 'outbound'],
  operations: [],
};

export const chatAdapter = (): IntegrationAdapterPort => ({ descriptor: CHAT });

/** What the fake chat of a connection kept: shared by every channel the core builds for it. */
export class ChannelScript {
  readonly sent: { message: ChatMessage; shortKey: string; ref: ExternalRef }[] = [];
  readonly updates: { ref: ExternalRef; message: ChatMessage; shortKey: string }[] = [];
  readonly texts: string[] = [];
  /** Consumed one per `send`: the failures to raise before the next success. */
  failures: Error[] = [];
  /** Holds every `send` until released. */
  gate: Promise<void> | null = null;
  handler: InboundHandler | null = null;
  /** What `listen` reports first; an unauthorized error ends the listening, as a real channel does. */
  status: ChannelStatus = { state: 'listening' };
  listens = 0;
  aborted = 0;
}

/** A channel that records what the core asks of it in the script of its connection. */
export class FakeChannel implements ChatChannelPort {
  readonly options: ChannelOptions;
  private readonly script: ChannelScript;
  private readonly counter: { next: number };

  constructor(options: ChannelOptions, script: ChannelScript, counter: { next: number }) {
    this.options = options;
    this.script = script;
    this.counter = counter;
  }

  private target(): string {
    return this.options.connection.params.chat_id ?? '';
  }

  deliver(message: OutboundMessage): Promise<ExternalRef> {
    return this.send(message.draw, message.delivery.shortKey);
  }

  async send(draw: Draw, shortKey: string): Promise<ExternalRef> {
    if (this.script.gate !== null) await this.script.gate;
    const failure = this.script.failures.shift();
    if (failure) throw failure;
    const ref = { chat_id: this.target(), message_id: this.counter.next++ };
    this.script.sent.push({ message: draw(DEFAULT_LIMITS), shortKey, ref });
    return ref;
  }

  update(ref: ExternalRef, draw: Draw, shortKey: string): Promise<void> {
    this.script.updates.push({ ref, message: draw(DEFAULT_LIMITS), shortKey });
    return Promise.resolve();
  }

  sendText(text: string): Promise<ExternalRef> {
    const failure = this.script.failures.shift();
    if (failure) return Promise.reject(failure);
    this.script.texts.push(text);
    return Promise.resolve({ chat_id: this.target(), message_id: this.counter.next++ });
  }

  listen(
    handler: InboundHandler,
    signal: AbortSignal,
    report: (status: ChannelStatus) => void,
  ): Promise<void> {
    this.script.listens += 1;
    this.script.handler = handler;
    report(this.script.status);
    if (this.script.status.state === 'error' && this.script.status.unauthorized)
      return Promise.resolve();
    return new Promise((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          this.script.aborted += 1;
          resolve();
        },
        { once: true },
      );
    });
  }
}

export interface FakeChannels {
  factory: ChannelFactoryPort;
  /** Every channel built, in order. */
  built: FakeChannel[];
  /** What the chat of a connection kept; made on first use. */
  of(connectionId: string): ChannelScript;
  /** How many messages every chat received together. */
  sentTotal(): number;
}

export function fakeChannels(): FakeChannels {
  const built: FakeChannel[] = [];
  const scripts = new Map<string, ChannelScript>();
  const counter = { next: 100 };
  const scriptOf = (id: string): ChannelScript => {
    const found = scripts.get(id) ?? new ChannelScript();
    scripts.set(id, found);
    return found;
  };
  const factory: ChannelFactoryPort = {
    kind: 'chat',
    language: (params) => (params.language === 'ru' ? 'ru' : 'en'),
    allows: (params, chat, user) =>
      params.chat_id === chat && (params.allowed_users ?? '').split(',').includes(user),
    missingForSubscription: (params) => (params.chat_id === undefined ? 'chat_id' : null),
    create: (options) => {
      const channel = new FakeChannel(options, scriptOf(options.connection.id), counter);
      built.push(channel);
      return channel;
    },
  };
  return {
    factory,
    built,
    of: scriptOf,
    sentTotal: () => [...scripts.values()].reduce((sum, one) => sum + one.sent.length, 0),
  };
}

export const permanent = (message = 'rejected'): ChannelFailure =>
  new ChannelFailure(message, { permanent: true });
export const temporary = (message = 'unavailable', retryAfterMs?: number): ChannelFailure =>
  new ChannelFailure(message, { permanent: false, retryAfterMs: retryAfterMs ?? null });

export const eventData = (patch: Partial<EventData> = {}): EventData => ({
  number: 1,
  title: 'Task',
  project: 'app',
  pipeline: 'feature',
  group: 'g',
  groupTitle: 'G',
  step: 'plan',
  question: null,
  questions: null,
  humanOnly: null,
  summary: null,
  reason: null,
  outcome: null,
  merged: 0,
  groups: 1,
  asked: 0,
  ...patch,
});

export const eventOf = (patch: Partial<NotificationEvent> = {}): NotificationEvent => ({
  key: 'r1/g/needs_human/1',
  kind: 'question',
  run: 'r1',
  repository: '/work/app',
  group: 'g',
  data: eventData(),
  ...patch,
});

/** An enabled connection `main` of the fake kind with its secret, shared by every project. */
export async function chatConnection(
  base: Fixture,
  options: {
    name?: string;
    params?: Record<string, string>;
    repository?: string;
    enabled?: boolean;
  } = {},
): Promise<string> {
  const { connections } = base.services;
  const added = await connections.add({
    kind: 'chat',
    name: options.name ?? 'main',
    ...(options.repository === undefined ? { global: true } : { repository: options.repository }),
    params: options.params ?? { chat_id: '-100' },
  });
  await connections.setSecret(added.id, 'token', 'secret-token');
  if (options.enabled !== false) await connections.enable(added.id);
  return added.id;
}

export { fixture };

// --- the services over a fake channel and fake runs ---------------------------------------------

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { transition, type Event } from '../../../src/feature/runs/machine/index.ts';
import type { RunsServices } from '../../../src/feature/runs/services/index.ts';
import type { RunState } from '../../../src/feature/runs/types/index.ts';
import {
  createNotificationsServices,
  type NotificationsServices,
} from '../../../src/feature/notifications/services/index.ts';
import { createSwarmConfigServices } from '../../../src/feature/swarm-config/services/index.ts';
import { finish, group, run, step } from '../runs/helpers.ts';

export interface Harness {
  base: Fixture;
  channels: FakeChannels;
  /** The services; `restart()` builds them again over the same database, as a daemon restart does. */
  notifications: NotificationsServices;
  restart(): NotificationsServices;
  states: Map<string, RunState>;
  logs: string[];
  clock: { time: number };
  /** Stores the run and tells the dispatcher, as `RunsEngine.save` does; waits for the lanes. */
  save(state: RunState): Promise<void>;
  applied: { state: RunState; event: Event }[];
  /** Thrown by the next `apply` of an answer, once. */
  applyError: { error: Error | null };
  published: string[];
  close(): Promise<void>;
}

export function harness(
  options: { settings?: string; start?: boolean; webhook?: Partial<WebhookFactoryOptions> } = {},
): Harness {
  const clock = { time: 1_000_000 };
  const now = () => clock.time;
  let current: NotificationsServices | undefined;
  const base = fixture({
    adapters: [chatAdapter(), webhookAdapter()],
    now,
    // The registry tells the channels about every change, as the daemon wires it.
    overrides: {
      changes: {
        connectionChanged: (id, change) => current?.channels.connectionChanged(id, change),
      },
    },
  });
  const channels = fakeChannels();
  const states = new Map<string, RunState>();
  const logs: string[] = [];
  const published: string[] = [];
  const applied: Harness['applied'] = [];
  const applyError: Harness['applyError'] = { error: null };
  const directory = mkdtempSync(join(tmpdir(), 'aip-notify-xdg-'));
  mkdirSync(join(directory, 'aip'), { recursive: true });
  if (options.settings !== undefined) {
    writeFileSync(join(directory, 'aip', 'settings.yaml'), options.settings);
  }
  const { config } = createSwarmConfigServices({
    environment: { XDG_CONFIG_HOME: directory, HOME: directory },
  });
  const built: NotificationsServices[] = [];
  const build = (): NotificationsServices => {
    const services = createNotificationsServices({
      database: base.database,
      integrations: base.services,
      registry: base.registry,
      runs: runs(),
      config,
      kinds: [
        channels.factory,
        webhookChannelFactory({ proxy: () => null, version: 'test', ...options.webhook }),
      ],
      publish: {
        subscriptionsChanged: () => void published.push('subscriptions'),
        journalChanged: (id) => void published.push(`journal:${id}`),
        channelChanged: (id, status) =>
          void published.push(`channel:${id}:${status?.state ?? '-'}`),
      },
      log: (message) => void logs.push(message),
      now,
      restartMs: 5,
    });
    built.push(services);
    current = services;
    // A running daemon has started its dispatcher; a test may want to start it itself.
    if (options.start !== false) void services.dispatcher.start();
    return services;
  };
  const runs = (): RunsServices =>
    ({
      states: { all: () => [...states.values()], lookup: (id: string) => states.get(id) },
      engine: {
        serial: <T>(work: () => Promise<T>) => work(),
        apply: (state: RunState, event: Event) => {
          if (applyError.error !== null) {
            const error = applyError.error;
            applyError.error = null;
            return Promise.reject(error);
          }
          transition(state, event, now());
          applied.push({ state, event });
          current?.dispatcher.runChanged(state);
          return Promise.resolve();
        },
      },
    }) as unknown as RunsServices;
  const notifications = build();
  return {
    base,
    channels,
    get notifications() {
      return current!;
    },
    restart: () => {
      const previous = current!;
      void previous.dispatcher.stop();
      return build();
    },
    states,
    logs,
    clock,
    applied,
    applyError,
    published,
    save: async (state) => {
      states.set(state.run.id, state);
      current!.dispatcher.runChanged(state);
      await current!.dispatcher.idle();
    },
    close: async () => {
      for (const services of built) {
        await services.channels.stop();
        await services.dispatcher.stop();
      }
    },
  } satisfies Harness & { notifications: NotificationsServices } as Harness;
}

/** A run of the project `app` whose group `group-1` asks the questions given. */
export function asking(
  questions: { text: string; options?: string[]; recommendation?: string }[] | null,
  options: { id?: string; humanOnly?: boolean; feedback?: string } = {},
): RunState {
  const state = run(1, { id: options.id ?? 'run000000001' });
  state.run.repository = '/work/app';
  step(state);
  finish(state, 'needs_human', {
    ...(questions === null ? { feedback: options.feedback ?? 'what now?' } : { questions }),
    ...(options.humanOnly ? { humanOnly: true } : {}),
  });
  return state;
}

export { finish, group, step };
