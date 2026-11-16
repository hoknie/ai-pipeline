import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  type QueueView,
  type RunCreated,
  type StreamEvent,
} from '../../src/presentation/ipc/contract/index.ts';
import { subscribe } from '../../src/presentation/ipc/client/index.ts';

import { copyTemplateRepo } from '../fixtures/template-repo.ts';
import { POLL_MS, PIPELINE_CONFIG, harness, startRun, until, type Harness } from './harness.ts';

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
      pipeline: 'feature',
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

  it('carries the variant and its name in the run event', async () => {
    const h = (current = await harness(`${PIPELINE_CONFIG}      variants:
        light:
          name: Light
          skip: [review]
`));
    const events: StreamEvent[] = [];
    subscribe(h.socket, (line) => events.push(streamEventSchema.parse(JSON.parse(line))));
    await until('the snapshot', () => events.length > 0);
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      variant: 'light',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await until('the event of the run', () =>
      events.some(
        (event) =>
          event.event === 'run' &&
          (event.run as unknown as { id: string }).id === runId &&
          (event.run as unknown as { variant: string }).variant === 'light',
      ),
    );
    const event = events.find((entry) => entry.event === 'run');
    expect(event?.event === 'run' ? event.run : null).toMatchObject({
      variant: 'light',
      variantName: 'Light',
    });
  });

  it('sends a queue event on every change and the queues in the snapshot', async () => {
    const h = (current = await harness());
    const events: StreamEvent[] = [];
    const first = await h.call('queue_add', { repository: h.repo, pipeline: 'feature', task: 'A' });
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
      pipeline: 'feature',
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

describe('queue event of a dependent project', () => {
  it('sends the queue of the client when the task it waits for in another project starts', async () => {
    const h = (current = await harness());
    const lib = join(dirname(h.repo), 'lib');
    copyTemplateRepo(lib, PIPELINE_CONFIG, { 'lib.ts': 'export const value = 1;\n' });
    await h.call('repository_add', { path: lib });
    const api = (await h.call('queue_add', {
      repository: lib,
      pipeline: 'feature',
      task: 'API',
    })) as { item: string };
    await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'client',
      after: [api.item],
    });
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await until('the snapshot', () => events.length > 0);
    await h.call('queue_run_now', { repository: lib, item: api.item });
    await until('the queue event of the client', () =>
      events.some(
        (event) =>
          event.event === 'queue' &&
          (event.queue as unknown as QueueView).repository === h.repo &&
          (event.queue as unknown as QueueView).items[0]?.after[0]?.kind === 'run',
      ),
    );
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });

  it('sends the queue of the client when the waiting task it waits for is edited', async () => {
    const h = (current = await harness());
    const lib = join(dirname(h.repo), 'lib');
    copyTemplateRepo(lib, PIPELINE_CONFIG, { 'lib.ts': 'export const value = 1;\n' });
    await h.call('repository_add', { path: lib });
    const api = (await h.call('queue_add', {
      repository: lib,
      pipeline: 'feature',
      task: 'API',
    })) as { item: string };
    await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'client',
      after: [api.item],
    });
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await until('the snapshot', () => events.length > 0);
    await h.call('queue_edit', { repository: lib, item: api.item, task: 'new API' });
    await until('the queue event of the client with the new title', () =>
      events.some(
        (event) =>
          event.event === 'queue' &&
          (event.queue as unknown as QueueView).repository === h.repo &&
          (event.queue as unknown as QueueView).items[0]?.after[0]?.title === 'new API',
      ),
    );
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });
});

describe('global queue event', () => {
  it('sends the global queue in the snapshot and when a task is added', async () => {
    const h = (current = await harness());
    const directory = join(h.environment.XDG_CONFIG_HOME!, 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'settings.yaml'), 'queue: { scope: global }\n');
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await until('the snapshot', () => events.length > 0);
    const snapshot = events[0]!;
    expect(snapshot).toMatchObject({ event: 'snapshot', queues: [] });
    await h.call('queue_add', { repository: h.repo, pipeline: 'feature', task: 'work' });
    await until('the event of the global queue', () =>
      events.some(
        (event) =>
          event.event === 'globalQueue' &&
          (event.globalQueue as { items: unknown[] } | null)?.items.length === 1,
      ),
    );
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });
});

describe('repositories event', () => {
  it('sends the registry in the snapshot and on every change of the list', async () => {
    const h = (current = await harness());
    h.script({ code: [{ verdict: 'needs_human', feedback: 'question?' }, {}] });
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
    await h.call('repository_update', { path: h.repo, name: 'Shop', color: 'teal' });
    await until('the renamed project', () =>
      repositories().some((event) => event.repositories.some((entry) => entry.label === 'Shop')),
    );
    expect(repositories().at(-1)?.repositories).toMatchObject([
      { path: h.repo, name: 'Shop', label: 'Shop', color: 'teal', enabled: true },
    ]);
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
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
