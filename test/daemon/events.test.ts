import { afterEach, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  subscribe,
  type RunCreated,
  type StreamEvent,
} from '../../src/protocol/index.ts';

import { POLL_MS, harness, startRun, until, type Harness } from './harness.ts';

// Each test needs a fresh daemon: the snapshot, the registry of repositories and the seq of the
// events are those of one daemon from its start.
let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

describe('event stream', () => {
  it('sends a snapshot, then every change of a run with growing seq', async () => {
    const h = (current = await harness());
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await until('the snapshot', () => events.length > 0);
    expect(events[0]).toMatchObject({ event: 'snapshot', runs: [] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (view) => view.finished);
    await until('the event of the finished run', () =>
      events.some(
        (event) =>
          event.event === 'run' && (event.run as unknown as { finished: boolean }).finished,
      ),
    );
    const runEvents = events.filter((event) => event.event === 'run');
    expect(runEvents.length).toBeGreaterThan(3);
    const steps = runEvents.map((event) =>
      event.event === 'run'
        ? (event.run as unknown as { groups: { step: string | null }[] }).groups[0]?.step
        : null,
    );
    expect(steps).toContain('code');
    expect(steps).toContain('review');
    const seqs = events.map((event) => event.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });

  it('sends a queue event on every change and the queues in the snapshot', async () => {
    const h = (current = await harness());
    const events: StreamEvent[] = [];
    const first = await h.call('queue_add', { repository: h.repo, workflow: 'feature', task: 'A' });
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await until('the snapshot', () => events.length > 0);
    const snapshot = events[0];
    expect(snapshot).toMatchObject({ event: 'snapshot' });
    expect(
      snapshot?.event === 'snapshot' ? snapshot.queues?.map((queue) => queue.repository) : null,
    ).toEqual([h.repo]);
    const second = (await h.call('queue_add', {
      repository: h.repo,
      workflow: 'feature',
      task: 'B',
    })) as { item: string };
    await h.call('queue_edit', { repository: h.repo, item: second.item, position: 1 });
    // a tags event comes after every event of the calls before it
    await h.call('tag_add', { repository: h.repo, name: 'marker' });
    await until('the marker', () => events.some((event) => event.event === 'tags'));
    const queueEvents = events.filter((event) => event.event === 'queue');
    expect(queueEvents).toHaveLength(2);
    const last = queueEvents.at(-1);
    const tasks = (
      last?.event === 'queue' ? (last.queue as unknown as { items: { task: string }[] }).items : []
    ).map((item) => item.task);
    expect(tasks).toEqual(['B', 'A']);
    expect(first).toBeDefined();
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });
});

describe('repositories event', () => {
  it('sends the registry in the snapshot and on every change of the list', async () => {
    const h = (current = await harness());
    h.script({ code: [{ verdict: 'needs_human', feedback: 'вопрос?' }, {}] });
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await until('the snapshot', () => events.length > 0);
    const snapshot = events[0];
    expect(snapshot?.event === 'snapshot' ? snapshot.repositories : null).toEqual([]);
    const repositories = () =>
      events.filter(
        (event): event is Extract<StreamEvent, { event: 'repositories' }> =>
          event.event === 'repositories',
      );
    await h.call('repository_add', { path: h.repo });
    await until('a repositories event', () => repositories().length > 0);
    expect(repositories()).toHaveLength(1);
    expect(repositories()[0]?.repositories).toMatchObject([{ path: h.repo, waiting: 0 }]);
    await h.call('repository_add', { path: h.repo });
    // a tags event comes after every event of the calls before it
    await h.call('tag_add', { repository: h.repo, name: 'marker' });
    await until('the marker', () => events.some((event) => event.event === 'tags'));
    expect(repositories()).toHaveLength(1);
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'needs_human');
    await until('the waiting repository', () =>
      repositories().some((event) => event.repositories.some((entry) => entry.waiting === 1)),
    );
    expect(repositories().at(-1)?.repositories).toMatchObject([
      { path: h.repo, unfinished: 1, waiting: 1 },
    ]);
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });
});
