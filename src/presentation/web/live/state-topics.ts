import {
  topicError,
  type LiveClient,
  type ReadTopic,
  type Held,
  type StateTopic,
  type TopicSignal,
} from './protocol.ts';

/** A topic that is not read again more often than this, whatever happens. */
export const TOPIC_THROTTLE_MS = 5000;

/** One topic read once for every subscriber of one user. */
interface Entry {
  topic: StateTopic;
  actor: string | undefined;
  subscribers: Map<LiveClient, Set<string>>;
  /** The JSON of the data the subscribers have; null until the first answer. */
  sent: string | null;
  reading: boolean;
  again: boolean;
  readAt: number;
  timer: NodeJS.Timeout | null;
}

function subscribersOf(entry: Entry): [LiveClient, string][] {
  return [...entry.subscribers].flatMap(([client, ids]) =>
    [...ids].map((id): [LiveClient, string] => [client, id]),
  );
}

/**
 * The topics whose data is one value (a group, its change documents, the providers): the value is
 * read when the daemon says something changed and sent only when it differs from the last one.
 */
export class StateTopics {
  private readonly read: ReadTopic;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(read: ReadTopic, now: () => number) {
    this.read = read;
    this.now = now;
  }

  /** Adds a subscriber; returns how to read its topic again and how to remove it. */
  watch(client: LiveClient, id: string, topic: StateTopic): Held {
    const key = JSON.stringify([client.actor ?? null, topic]);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        topic,
        actor: client.actor,
        subscribers: new Map(),
        sent: null,
        reading: false,
        again: false,
        readAt: -Infinity,
        timer: null,
      };
      this.entries.set(key, entry);
    } else if (entry.sent !== null) {
      client.send({ event: 'topic', id, data: JSON.parse(entry.sent) as unknown });
    }
    const ids = entry.subscribers.get(client) ?? new Set<string>();
    entry.subscribers.set(client, ids.add(id));
    // The first read failed for those who came before: this subscriber gets its own answer.
    if (entry.sent === null && !entry.reading) void this.refresh(entry);
    const watched = entry;
    const stop = (): void => {
      ids.delete(id);
      if (ids.size === 0) watched.subscribers.delete(client);
      if (watched.subscribers.size > 0) return;
      if (watched.timer) clearTimeout(watched.timer);
      this.entries.delete(key);
    };
    return { stop, refresh: () => void this.refresh(watched) };
  }

  signal(signal: TopicSignal): void {
    for (const entry of this.entries.values()) {
      const { topic } = entry;
      if (topic.kind === 'providers') {
        // Status and limits of the providers follow the runs.
        if (signal.event === 'run') this.later(entry);
      } else if (topic.runId !== signal.runId) {
        continue;
      } else if (signal.event === 'run') {
        void this.refresh(entry);
      } else if (topic.kind === 'group_spec' && topic.watch && topic.group === signal.group) {
        // An agent at work writes to its log; its documents may have changed with it.
        this.later(entry);
      }
    }
  }

  stop(): void {
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer);
    this.entries.clear();
  }

  /** Reads now, or once the quiet time since the last read is over. */
  private later(entry: Entry): void {
    if (entry.timer) return;
    const wait = entry.readAt + TOPIC_THROTTLE_MS - this.now();
    if (wait <= 0) {
      void this.refresh(entry);
      return;
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.refresh(entry);
    }, wait);
    entry.timer.unref();
  }

  private async refresh(entry: Entry): Promise<void> {
    if (entry.reading) {
      entry.again = true;
      return;
    }
    entry.reading = true;
    entry.readAt = this.now();
    try {
      const data = await this.read(entry.topic, entry.actor);
      const text = JSON.stringify(data ?? null);
      if (text !== entry.sent) {
        entry.sent = text;
        for (const [client, id] of subscribersOf(entry)) client.send({ event: 'topic', id, data });
      }
    } catch (error) {
      for (const [client, id] of subscribersOf(entry)) client.send(topicError(id, error));
    } finally {
      entry.reading = false;
    }
    if (entry.again && entry.subscribers.size > 0) {
      entry.again = false;
      void this.refresh(entry);
    }
  }
}
