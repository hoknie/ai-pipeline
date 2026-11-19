import type { Api } from '../api.ts';
import type { GroupSpecView, GroupView, ProvidersView, Transcript } from '../types.ts';

/** How often the topics are read with requests while the connection is down for long. */
export const TOPIC_POLL_MS = 3000;

interface Target {
  runId: string;
  group: string;
}

/** What a screen may watch over the live connection. */
export type LiveTopic =
  | ({ kind: 'transcript'; seq: number; after?: number } & Target)
  | ({ kind: 'group' } & Target)
  /** `watch`: read again while the log of the group grows, not only when the run changes. */
  | ({ kind: 'group_spec'; watch?: boolean } & Target)
  | { kind: 'providers'; repository?: string; level?: 'global' };

export interface TopicData {
  transcript: Transcript;
  group: GroupView;
  group_spec: GroupSpecView | null;
  providers: ProvidersView;
}

type Kind = LiveTopic['kind'];
type TopicOf<K extends Kind> = Extract<LiveTopic, { kind: K }>;

interface Entry {
  api: Api;
  topic: LiveTopic;
  onData: (data: never) => void;
  onError: (message: string) => void;
  /** The id of the subscription on this connection; null while it has none. */
  id: string | null;
  /** The line of the log the next part starts after. */
  cursor: number;
  /** Nothing more comes: the attempt ended. */
  done: boolean;
  reading: boolean;
  /** Grows when the source of the data changes, so an answer of the old source is dropped. */
  epoch: number;
}

/** Stops watching a topic; `refresh` asks for its data again now. */
export type Watch = (() => void) & { refresh(): void };

/** Sends a message over the connection; false while it is down. */
type Send = (message: object) => boolean;

function request(entry: Entry): Promise<unknown> {
  const { api, topic } = entry;
  if (topic.kind === 'transcript') {
    return api.transcript(topic.runId, topic.group, topic.seq, entry.cursor);
  }
  if (topic.kind === 'group') return api.group(topic.runId, topic.group);
  if (topic.kind === 'group_spec') return api.groupSpec(topic.runId, topic.group);
  return api.providers(topic.level);
}

/**
 * The data of the open screens: sent by the server over the live connection while it works, read
 * with requests once when it does not and every `TOPIC_POLL_MS` while the panel polls.
 */
export class Topics {
  private readonly entries = new Set<Entry>();
  private send: Send | null = null;
  private poller: ReturnType<typeof setInterval> | null = null;
  private counter = 0;

  /** Watches a topic; returns the function that stops it, with `refresh` to ask again now. */
  watch<K extends Kind>(
    api: Api,
    topic: TopicOf<K>,
    onData: (data: TopicData[K]) => void,
    onError: (message: string) => void = () => undefined,
  ): Watch {
    const entry: Entry = {
      api,
      topic,
      onData,
      onError,
      id: null,
      cursor: (topic as { after?: number }).after ?? 0,
      done: false,
      reading: false,
      epoch: 0,
    };
    this.entries.add(entry);
    if (this.send === null) this.read(entry);
    else this.subscribe(entry);
    const stop = (): void => {
      this.entries.delete(entry);
      if (entry.id !== null && !entry.done) this.send?.({ op: 'unsubscribe', id: entry.id });
    };
    const refresh = (): void => {
      if (!this.entries.has(entry)) return;
      if (this.send === null || entry.id === null) this.read(entry);
      else this.send({ op: 'refresh', id: entry.id });
    };
    return Object.assign(stop, { refresh });
  }

  /** The connection came up: every topic is subscribed on it. */
  opened(next: Send): void {
    this.stopPolling();
    this.send = next;
    for (const entry of this.entries) this.subscribe(entry);
  }

  /** The connection broke: the subscriptions went with it. */
  down(): void {
    this.send = null;
    for (const entry of this.entries) {
      entry.id = null;
      entry.epoch += 1;
    }
  }

  /** The connection is down for long: the topics are read with requests. */
  polling(): void {
    if (this.poller) return;
    for (const entry of this.entries) this.read(entry);
    this.poller = setInterval(() => {
      for (const entry of this.entries) this.read(entry);
    }, TOPIC_POLL_MS);
  }

  /** Nobody keeps a connection any more. */
  detach(): void {
    this.stopPolling();
    this.down();
  }

  /** Takes a message about a subscription; false when the event is not one. */
  message(event: { event: string; id?: unknown; data?: unknown; error?: unknown }): boolean {
    if (event.event !== 'topic' && event.event !== 'topic_error') return false;
    for (const entry of this.entries) {
      if (entry.id !== event.id) continue;
      if (event.event === 'topic') this.deliver(entry, event.data);
      else entry.onError(typeof event.error === 'string' ? event.error : 'the read failed');
    }
    return true;
  }

  private deliver(entry: Entry, data: unknown): void {
    if (entry.topic.kind === 'transcript') {
      const part = data as Transcript;
      entry.cursor = part.cursor;
      if (!part.running) entry.done = true;
    }
    (entry.onData as (data: unknown) => void)(data);
  }

  /** One request for the data of a topic; an answer the connection overtook is dropped. */
  private read(entry: Entry): void {
    if (entry.reading || entry.done) return;
    entry.reading = true;
    const { epoch } = entry;
    const current = (): boolean => this.entries.has(entry) && entry.epoch === epoch;
    request(entry)
      .then(
        (data) => {
          if (current()) this.deliver(entry, data);
        },
        (error: Error) => {
          if (current()) entry.onError(error.message);
        },
      )
      .finally(() => {
        entry.reading = false;
      });
  }

  private subscribe(entry: Entry): void {
    if (this.send === null || entry.done) return;
    entry.epoch += 1;
    entry.reading = false;
    this.counter += 1;
    entry.id = `s${this.counter}`;
    const topic =
      entry.topic.kind === 'transcript' ? { ...entry.topic, after: entry.cursor } : entry.topic;
    this.send({ op: 'subscribe', id: entry.id, topic });
  }

  private stopPolling(): void {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }
}

export const createTopics = (): Topics => new Topics();

/** The topics of the panel: one connection serves every screen. */
export const liveTopics: Topics = createTopics();
