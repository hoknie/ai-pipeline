// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTopics, TOPIC_POLL_MS } from '../src/shared/api/live/topics.ts';
import {
  RECONNECT_MS,
  connectLive,
  createFallback,
  type Connection,
} from '../src/shared/api/stream.ts';
import type { Transcript } from '../src/shared/api/types.ts';

import { FakeSocket, fakeApi, groupView, openFake } from './fixtures.ts';

afterEach(() => {
  vi.useRealTimers();
  FakeSocket.answers = true;
});

const part = (cursor: number, running: boolean, ...texts: string[]): Transcript => ({
  runId: 'run1',
  group: 'login',
  seq: 1,
  cursor,
  running,
  entries: texts.map((text) => ({ kind: 'text', text, at: null })),
});

const LOG = { kind: 'transcript', runId: 'run1', group: 'login', seq: 1 } as const;
const GROUP = { kind: 'group', runId: 'run1', group: 'login' } as const;

/** The messages the topics sent over a connection that is up. */
function connection(topics: ReturnType<typeof createTopics>) {
  const sent: { op: string; id: string; topic?: Record<string, unknown> }[] = [];
  topics.opened((message) => {
    sent.push(message as (typeof sent)[number]);
    return true;
  });
  return sent;
}

const flush = async (): Promise<void> => {
  for (let round = 0; round < 5; round += 1) await Promise.resolve();
};

describe('topics of the panel', () => {
  it('reads once with a request while there is no connection', async () => {
    vi.useFakeTimers();
    const api = fakeApi({ group: vi.fn(async () => groupView()) });
    const topics = createTopics();
    const got: unknown[] = [];
    topics.watch(api, GROUP, (view) => got.push(view));
    await flush();
    expect(got).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(TOPIC_POLL_MS * 3);
    expect(api.group).toHaveBeenCalledTimes(1);
  });

  it('subscribes on the connection, takes its messages and unsubscribes', async () => {
    const api = fakeApi();
    const topics = createTopics();
    const sent = connection(topics);
    const got: unknown[] = [];
    const errors: string[] = [];
    const stop = topics.watch(
      api,
      GROUP,
      (view) => got.push(view),
      (message) => errors.push(message),
    );
    expect(sent).toEqual([{ op: 'subscribe', id: sent[0]?.id, topic: GROUP }]);
    expect(api.group).not.toHaveBeenCalled();
    const id = sent[0]?.id;
    expect(topics.message({ event: 'topic', id, data: groupView() })).toBe(true);
    expect(topics.message({ event: 'topic_error', id, error: 'gone' })).toBe(true);
    expect(topics.message({ event: 'run' })).toBe(false);
    expect(got).toHaveLength(1);
    expect(errors).toEqual(['gone']);
    stop.refresh();
    stop();
    expect(sent.slice(1)).toEqual([
      { op: 'refresh', id },
      { op: 'unsubscribe', id },
    ]);
    topics.message({ event: 'topic', id, data: groupView() });
    expect(got).toHaveLength(1);
  });

  it('subscribes again after a break, the log from the line it stopped at', async () => {
    const api = fakeApi();
    const topics = createTopics();
    const first = connection(topics);
    const parts: Transcript[] = [];
    topics.watch(api, LOG, (next) => parts.push(next));
    topics.watch(api, GROUP, () => undefined);
    expect(first[0]?.topic).toEqual({ ...LOG, after: 0 });
    topics.message({ event: 'topic', id: first[0]?.id, data: part(40, true, 'a') });
    topics.down();
    // a message of the lost connection changes nothing
    topics.message({ event: 'topic', id: first[0]?.id, data: part(41, true, 'late') });
    const second = connection(topics);
    expect(second.map((message) => message.topic)).toEqual([{ ...LOG, after: 40 }, GROUP]);
    expect(second[0]?.id).not.toBe(first[0]?.id);
    topics.message({ event: 'topic', id: second[0]?.id, data: part(43, false, 'b', 'c', 'd') });
    expect(
      parts.flatMap((next) => next.entries.map((entry) => entry.kind === 'text' && entry.text)),
    ).toEqual(['a', 'b', 'c', 'd']);
    // the attempt ended: nothing to unsubscribe and nothing to subscribe again
    topics.down();
    expect(connection(topics).map((message) => message.topic)).toEqual([GROUP]);
  });

  it('reads with requests while the panel polls and stops when the connection is back', async () => {
    vi.useFakeTimers();
    let cursor = 0;
    const transcript = vi.fn(async (_run: string, _group: string, _seq: number, after: number) => {
      cursor = after + 1;
      return part(cursor, true, `line ${cursor}`);
    });
    const api = fakeApi({ transcript });
    const topics = createTopics();
    const parts: Transcript[] = [];
    topics.watch(api, LOG, (next) => parts.push(next));
    await flush();
    topics.polling();
    await flush();
    await vi.advanceTimersByTimeAsync(TOPIC_POLL_MS * 2);
    expect(transcript.mock.calls.map((call) => call[3])).toEqual([0, 1, 2, 3]);
    expect(parts.map((next) => next.cursor)).toEqual([1, 2, 3, 4]);
    const sent = connection(topics);
    expect(sent[0]?.topic).toEqual({ ...LOG, after: 4 });
    await vi.advanceTimersByTimeAsync(TOPIC_POLL_MS * 3);
    expect(transcript).toHaveBeenCalledTimes(4);
  });

  it('drops the answer of a request that the connection overtook', async () => {
    let answer: (value: Transcript) => void = () => undefined;
    const transcript = vi.fn(
      () =>
        new Promise<Transcript>((resolve) => {
          answer = resolve;
        }),
    );
    const topics = createTopics();
    const parts: Transcript[] = [];
    topics.watch(fakeApi({ transcript }), LOG, (next) => parts.push(next));
    const sent = connection(topics);
    topics.message({ event: 'topic', id: sent[0]?.id, data: part(2, true, 'a', 'b') });
    answer(part(2, true, 'a', 'b'));
    await flush();
    expect(parts).toHaveLength(1);
  });
});

describe('live connection', () => {
  it('opens again after a break and polls only while it is down for long', async () => {
    vi.useFakeTimers();
    const states: Connection[] = [];
    const poll = vi.fn(async () => undefined);
    const fallback = createFallback(
      poll,
      () => states.push('polling'),
      () => false,
    );
    const events: string[] = [];
    let opened = 0;
    const live = connectLive(openFake, fallback, {
      live: () => states.at(-1) !== 'live' && states.push('live'),
      opened: () => (opened += 1),
      event: (event) => events.push(event.event),
      broken: () => states.push('reconnecting'),
    });
    const first = FakeSocket.last!;
    expect(live.send({ op: 'x' })).toBe(false);
    first.send({ event: 'snapshot', runs: [] });
    expect(opened).toBe(1);
    expect(live.send({ op: 'x' })).toBe(true);
    expect(first.sent).toEqual([{ op: 'x' }]);
    first.fail();
    expect(states).toEqual(['live', 'reconnecting']);
    expect(live.send({ op: 'x' })).toBe(false);
    await vi.advanceTimersByTimeAsync(RECONNECT_MS);
    const second = FakeSocket.last!;
    expect(second).not.toBe(first);
    // the server is still away: the new connection breaks too
    second.fail();
    await vi.advanceTimersByTimeAsync(2500);
    expect(states.at(-1)).toBe('polling');
    expect(poll).toHaveBeenCalled();
    FakeSocket.last!.open();
    expect(states.at(-1)).toBe('live');
    expect(opened).toBe(2);
    const calls = poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(calls);
    expect(events).toEqual(['snapshot']);
    live.close();
    expect(FakeSocket.last!.closed).toBe(true);
    FakeSocket.last!.fail();
    await vi.advanceTimersByTimeAsync(RECONNECT_MS * 2);
    expect(states.at(-1)).toBe('live');
  });
});
