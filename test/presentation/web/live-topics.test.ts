import { afterEach, describe, expect, it, vi } from 'vitest';

import { panel } from '../../../src/presentation/web/errors.ts';
import {
  MAX_MESSAGE_BYTES,
  MAX_SUBSCRIPTIONS,
  parseClientMessage,
  type LiveClient,
  type Topic,
  type TopicMessage,
} from '../../../src/presentation/web/live/protocol.ts';
import { TOPIC_THROTTLE_MS } from '../../../src/presentation/web/live/state-topics.ts';
import { Topics } from '../../../src/presentation/web/live/topics.ts';

afterEach(() => vi.useRealTimers());

interface Probe extends LiveClient {
  got: TopicMessage[];
}

function client(actor?: string): Probe {
  const got: TopicMessage[] = [];
  return { actor, got, send: (message) => got.push(message) };
}

/** Lets the reads that are under way finish. */
const flush = async (): Promise<void> => {
  for (let round = 0; round < 5; round += 1) await Promise.resolve();
};

const GROUP: Topic = { kind: 'group', runId: 'r1', group: 'login' };

describe('messages of a client', () => {
  it('takes the four kinds of topics and an unsubscription', () => {
    const topics: unknown[] = [
      { kind: 'transcript', runId: 'r1', group: 'login', seq: 2, after: 40 },
      { kind: 'group', runId: 'r1', group: 'login' },
      { kind: 'group_spec', runId: 'r1', group: 'login', watch: true },
      { kind: 'providers', repository: '/work/app', level: 'global' },
      { kind: 'providers' },
    ];
    for (const topic of topics) {
      const text = JSON.stringify({ op: 'subscribe', id: 'a', topic });
      expect(parseClientMessage(text)).toEqual({ op: 'subscribe', id: 'a', topic });
    }
    expect(parseClientMessage('{"op":"unsubscribe","id":"a"}')).toEqual({
      op: 'unsubscribe',
      id: 'a',
    });
  });

  it('refuses what it does not know, naming the id and never the content', () => {
    const refused = (value: unknown) =>
      parseClientMessage(typeof value === 'string' ? value : JSON.stringify(value));
    expect(refused('{')).toMatchObject({ event: 'topic_error', id: '', code: 'live.invalid' });
    expect(refused({ op: 'subscribe', id: 'a', topic: { kind: 'nope' } })).toMatchObject({
      event: 'topic_error',
      id: 'a',
    });
    expect(
      refused({ op: 'subscribe', id: 'a', topic: { kind: 'group', runId: 'r1' } }),
    ).toMatchObject({ event: 'topic_error', id: 'a' });
    expect(refused({ op: 'subscribe', id: 'a', topic: { ...GROUP, secret: 'hunter2' } })).toEqual({
      event: 'topic_error',
      id: 'a',
      error: 'invalid message',
      code: 'live.invalid',
    });
    expect(refused({ op: 'shutdown', id: 'a' })).toMatchObject({ event: 'topic_error' });
    // a message longer than the limit never reaches the parser: the connection is closed
    expect(MAX_MESSAGE_BYTES).toBe(4096);
  });
});

describe('Topics', () => {
  it('sends the data at once and again only when it changed', async () => {
    let view = { status: 'running' };
    const read = vi.fn(async () => view);
    const topics = new Topics(read);
    const one = client();
    topics.handle(one, { op: 'subscribe', id: 'g1', topic: GROUP });
    await flush();
    expect(one.got).toEqual([{ event: 'topic', id: 'g1', data: { status: 'running' } }]);
    topics.signal({ event: 'run', runId: 'r1' });
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(one.got).toHaveLength(1);
    view = { status: 'merged' };
    topics.signal({ event: 'run', runId: 'r1' });
    topics.signal({ event: 'run', runId: 'other' });
    await flush();
    expect(one.got.at(-1)).toEqual({ event: 'topic', id: 'g1', data: { status: 'merged' } });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('reads one topic once for all its subscribers and gives a late one the last data', async () => {
    const read = vi.fn(async () => ({ status: 'running' }));
    const topics = new Topics(read);
    const [one, two, late] = [client(), client(), client()];
    topics.handle(one, { op: 'subscribe', id: 'a', topic: GROUP });
    topics.handle(two, { op: 'subscribe', id: 'b', topic: GROUP });
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(one.got).toHaveLength(1);
    expect(two.got).toEqual([{ event: 'topic', id: 'b', data: { status: 'running' } }]);
    topics.handle(late, { op: 'subscribe', id: 'c', topic: GROUP });
    expect(late.got).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
    // another user reads for themselves
    topics.handle(client('bob'), { op: 'subscribe', id: 'd', topic: GROUP });
    await flush();
    expect(read).toHaveBeenLastCalledWith(GROUP, 'bob');
  });

  it('stops sending after an unsubscription and after the connection closed', async () => {
    let count = 0;
    const read = vi.fn(async () => ({ count: (count += 1) }));
    const topics = new Topics(read);
    const [one, two] = [client(), client()];
    topics.handle(one, { op: 'subscribe', id: 'a', topic: GROUP });
    topics.handle(two, { op: 'subscribe', id: 'b', topic: GROUP });
    await flush();
    topics.handle(one, { op: 'unsubscribe', id: 'a' });
    topics.drop(two);
    topics.signal({ event: 'run', runId: 'r1' });
    await flush();
    expect(one.got).toHaveLength(1);
    expect(two.got).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('answers a failed read with an error and keeps the subscription', async () => {
    let fail = true;
    const read = vi.fn(async () => {
      if (fail) throw panel('not_found', 'unknown run', 'runs.unknown');
      return { status: 'running' };
    });
    const topics = new Topics(read);
    const one = client();
    topics.handle(one, { op: 'subscribe', id: 'g1', topic: GROUP });
    await flush();
    expect(one.got).toEqual([
      { event: 'topic_error', id: 'g1', error: 'unknown run', code: 'runs.unknown' },
    ]);
    fail = false;
    topics.signal({ event: 'run', runId: 'r1' });
    await flush();
    expect(one.got.at(-1)).toMatchObject({ event: 'topic', id: 'g1' });
  });

  it('reads again at once when the client asks', async () => {
    let status = 'ok';
    const read = vi.fn(async () => ({ status }));
    const topics = new Topics(read);
    const one = client();
    topics.handle(one, { op: 'subscribe', id: 'p1', topic: { kind: 'providers' } });
    await flush();
    topics.handle(one, { op: 'refresh', id: 'p1' });
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(one.got).toHaveLength(1);
    status = 'limit';
    topics.handle(one, { op: 'refresh', id: 'p1' });
    topics.handle(one, { op: 'refresh', id: 'unknown' });
    await flush();
    expect(one.got.at(-1)).toEqual({ event: 'topic', id: 'p1', data: { status: 'limit' } });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('refuses a taken id and the subscription over the limit', async () => {
    const topics = new Topics(async () => ({}));
    const one = client();
    for (let index = 0; index < MAX_SUBSCRIPTIONS; index += 1) {
      topics.handle(one, { op: 'subscribe', id: `s${index}`, topic: GROUP });
    }
    await flush();
    one.got.length = 0;
    topics.handle(one, { op: 'subscribe', id: 's0', topic: GROUP });
    topics.handle(one, { op: 'subscribe', id: 'over', topic: GROUP });
    expect(one.got).toEqual([
      expect.objectContaining({ event: 'topic_error', id: 's0', code: 'live.duplicate' }),
      expect.objectContaining({ event: 'topic_error', id: 'over', code: 'live.limit' }),
    ]);
    topics.handle(one, { op: 'unsubscribe', id: 's1' });
    topics.handle(one, { op: 'subscribe', id: 'over', topic: GROUP });
    expect(one.got).toHaveLength(3);
    expect(one.got[2]).toMatchObject({ event: 'topic', id: 'over' });
  });

  it('reads the log on from its cursor and ends the subscription with the attempt', async () => {
    const lines = ['a', 'b'];
    let running = true;
    const read = vi.fn(async (topic: Topic) => {
      const after = topic.kind === 'transcript' ? (topic.after ?? 0) : 0;
      return { cursor: lines.length, running, entries: lines.slice(after) };
    });
    const topics = new Topics(read);
    const one = client();
    const topic: Topic = { kind: 'transcript', runId: 'r1', group: 'login', seq: 2 };
    topics.handle(one, { op: 'subscribe', id: 't1', topic });
    await flush();
    expect(one.got).toEqual([
      { event: 'topic', id: 't1', data: { cursor: 2, running: true, entries: ['a', 'b'] } },
    ]);
    // a signal of another attempt or without new lines sends nothing
    topics.signal({ event: 'log', runId: 'r1', group: 'login', attempt: 1 });
    topics.signal({ event: 'log', runId: 'r1', group: 'login', attempt: 2 });
    await flush();
    expect(one.got).toHaveLength(1);
    lines.push('c');
    topics.signal({ event: 'log', runId: 'r1', group: 'login', attempt: 2 });
    await flush();
    expect(one.got.at(-1)).toMatchObject({ data: { cursor: 3, entries: ['c'] } });
    // the run changed: the attempt ended
    running = false;
    topics.signal({ event: 'run', runId: 'r1' });
    await flush();
    expect(one.got.at(-1)).toMatchObject({ data: { cursor: 3, running: false, entries: [] } });
    const calls = read.mock.calls.length;
    topics.signal({ event: 'log', runId: 'r1', group: 'login', attempt: 2 });
    await flush();
    expect(read).toHaveBeenCalledTimes(calls);
    // the id is free again
    topics.handle(one, { op: 'subscribe', id: 't1', topic: { ...topic, after: 3 } });
    await flush();
    expect(one.got.at(-1)).toMatchObject({ event: 'topic', id: 't1', data: { entries: [] } });
  });

  it('reads the change documents on a log signal at most once per quiet time, when watched', async () => {
    vi.useFakeTimers();
    let tasks = '- [ ] one';
    const read = vi.fn(async () => ({ tasks }));
    const topics = new Topics(read);
    const [watching, plain] = [client(), client()];
    const spec = { kind: 'group_spec', runId: 'r1', group: 'login' } as const;
    topics.handle(watching, { op: 'subscribe', id: 'w', topic: { ...spec, watch: true } });
    topics.handle(plain, { op: 'subscribe', id: 'p', topic: spec });
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    tasks = '- [x] one';
    const log = { event: 'log', runId: 'r1', group: 'login', attempt: 1 } as const;
    for (let index = 0; index < 20; index += 1) topics.signal(log);
    topics.signal({ ...log, group: 'other' });
    await flush();
    // within the quiet time nothing is read
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(TOPIC_THROTTLE_MS);
    expect(read).toHaveBeenCalledTimes(3);
    expect(watching.got.at(-1)).toEqual({ event: 'topic', id: 'w', data: { tasks: '- [x] one' } });
    expect(plain.got).toHaveLength(1);
    // a change of the run reads both at once
    topics.signal({ event: 'run', runId: 'r1' });
    await flush();
    expect(read).toHaveBeenCalledTimes(5);
    expect(plain.got.at(-1)).toEqual({ event: 'topic', id: 'p', data: { tasks: '- [x] one' } });
    topics.stop();
  });

  it('reads the providers after run events at most once per quiet time and sends them once', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => ({ providers: [{ slug: 'zai', status: 'ok' }] }));
    const topics = new Topics(read);
    const one = client();
    topics.handle(one, { op: 'subscribe', id: 'p1', topic: { kind: 'providers' } });
    await flush();
    // 30 events of runs within a minute
    for (let index = 0; index < 30; index += 1) {
      topics.signal({ event: 'run', runId: `r${index % 3}` });
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(one.got).toHaveLength(1);
    expect(read.mock.calls.length).toBeLessThanOrEqual(1 + 60_000 / TOPIC_THROTTLE_MS);
    expect(read.mock.calls.length).toBeGreaterThan(2);
    topics.stop();
  });
});
