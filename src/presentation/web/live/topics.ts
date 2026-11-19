import { StateTopics } from './state-topics.ts';
import {
  MAX_SUBSCRIPTIONS,
  topicError,
  type ClientMessage,
  type Held,
  type LiveClient,
  type ReadTopic,
  type TopicSignal,
  type TranscriptTopic,
} from './protocol.ts';

interface TranscriptAnswer {
  cursor: number;
  running: boolean;
  entries: unknown[];
}

/** The log of one attempt for one subscriber, read on from where it stopped. */
interface TranscriptSubscription {
  client: LiveClient;
  id: string;
  topic: TranscriptTopic;
  cursor: number;
  sent: boolean;
  reading: boolean;
  again: boolean;
  closed: boolean;
}

/** The subscriptions of every connection: what each one watches and when it is read again. */
export class Topics {
  private readonly read: ReadTopic;
  private readonly states: StateTopics;
  /** Per connection: the ids it uses and how to drop each. */
  private readonly clients = new Map<LiveClient, Map<string, Held>>();
  private readonly transcripts = new Set<TranscriptSubscription>();

  constructor(read: ReadTopic, now: () => number = Date.now) {
    this.read = read;
    this.states = new StateTopics(read, now);
  }

  handle(client: LiveClient, message: ClientMessage): void {
    const held = this.clients.get(client) ?? new Map<string, Held>();
    this.clients.set(client, held);
    if (message.op === 'refresh') return held.get(message.id)?.refresh();
    if (message.op === 'unsubscribe') {
      held.get(message.id)?.stop();
      held.delete(message.id);
      return;
    }
    const refuse = (error: string, code: string): void =>
      client.send({ event: 'topic_error', id: message.id, error, code });
    if (held.has(message.id)) return refuse('this id is already subscribed', 'live.duplicate');
    if (held.size >= MAX_SUBSCRIPTIONS) return refuse('too many subscriptions', 'live.limit');
    const { topic, id } = message;
    held.set(
      id,
      topic.kind === 'transcript'
        ? this.watchTranscript(client, id, topic)
        : this.states.watch(client, id, topic),
    );
  }

  /** The connection closed: nothing of it stays. */
  drop(client: LiveClient): void {
    for (const held of this.clients.get(client)?.values() ?? []) held.stop();
    this.clients.delete(client);
  }

  signal(signal: TopicSignal): void {
    this.states.signal(signal);
    for (const subscription of this.transcripts) {
      const { topic } = subscription;
      if (topic.runId !== signal.runId) continue;
      // A change of the run may be the end of the attempt: its last lines and `running: false`.
      if (
        signal.event === 'log' &&
        (signal.group !== topic.group || signal.attempt !== topic.seq)
      ) {
        continue;
      }
      void this.readTranscript(subscription);
    }
  }

  /** Everything is dropped with the server. */
  stop(): void {
    for (const client of [...this.clients.keys()]) this.drop(client);
    this.states.stop();
  }

  private watchTranscript(client: LiveClient, id: string, topic: TranscriptTopic): Held {
    const subscription: TranscriptSubscription = {
      client,
      id,
      topic,
      cursor: topic.after ?? 0,
      sent: false,
      reading: false,
      again: false,
      closed: false,
    };
    this.transcripts.add(subscription);
    void this.readTranscript(subscription);
    return {
      refresh: () => void this.readTranscript(subscription),
      stop: () => {
        subscription.closed = true;
        this.transcripts.delete(subscription);
      },
    };
  }

  private async readTranscript(subscription: TranscriptSubscription): Promise<void> {
    if (subscription.closed) return;
    if (subscription.reading) {
      subscription.again = true;
      return;
    }
    subscription.reading = true;
    const { client, id, topic } = subscription;
    try {
      const answer = (await this.read(
        { ...topic, after: subscription.cursor },
        client.actor,
      )) as TranscriptAnswer;
      if (subscription.closed) return;
      subscription.cursor = answer.cursor;
      if (!subscription.sent || answer.entries.length > 0 || !answer.running) {
        subscription.sent = true;
        client.send({ event: 'topic', id, data: answer });
      }
      // The message with `running: false` is the last one of the subscription.
      if (!answer.running) {
        subscription.closed = true;
        this.transcripts.delete(subscription);
        this.clients.get(client)?.delete(id);
      }
    } catch (error) {
      if (!subscription.closed) client.send(topicError(id, error));
    } finally {
      subscription.reading = false;
    }
    if (subscription.again) {
      subscription.again = false;
      void this.readTranscript(subscription);
    }
  }
}
