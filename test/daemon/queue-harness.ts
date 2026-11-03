import { afterEach } from 'vitest';

import type { QueueView, RunQueued, RunView } from '../../src/protocol/index.ts';
import { POLL_MS, WORKFLOW_CONFIG, harness, type Harness } from './harness.ts';

// Shared by the queue test files; importing this module stops the daemon a test left running.
let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

export async function start(config = WORKFLOW_CONFIG): Promise<Harness> {
  current = await harness(config);
  return current;
}

/** Stops the daemon inside a test, so that the hook does not stop it again. */
export async function stop(h: Harness): Promise<void> {
  await h.close();
  if (current === h) current = null;
}

export const queueOf = async (h: Harness): Promise<QueueView> =>
  (await h.call('queue', { repository: h.repo })) as QueueView;

export async function add(h: Harness, task: string, extra: Record<string, unknown> = {}) {
  const view = (await h.call('queue_add', {
    repository: h.repo,
    workflow: 'feature',
    // the fake agent counts its script per group: one task text makes the counter global
    task: 'работа',
    title: task,
    ...extra,
  })) as QueueView & { item: string };
  return view;
}

export async function waitQueue(
  h: Harness,
  done: (queue: QueueView) => boolean,
  timeoutMs = 30_000,
): Promise<QueueView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const queue = await queueOf(h);
    if (done(queue)) return queue;
    if (Date.now() > deadline) throw new Error(`timed out; queue: ${JSON.stringify(queue)}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export const allRuns = async (h: Harness): Promise<RunView[]> =>
  ((await h.call('status', {})) as RunView[]).sort((a, b) => a.createdAt - b.createdAt);

export const WRITE_LIB = { write: { 'lib.ts': 'export const value = 2;\n' } };

export const WORKER_QUEUE_CONFIG = WORKFLOW_CONFIG.replace(
  'coder: { name: Кодировщик }',
  'coder: { name: Кодировщик, queue: true }',
);

export const itemById = (queue: QueueView, id: string) =>
  queue.items.find((item) => item.id === id);

export async function run_(h: Harness, title: string, after: string[]): Promise<RunQueued> {
  return (await h.call('run', {
    repository: h.repo,
    workflow: 'feature',
    task: 'работа',
    title,
    after,
  })) as RunQueued;
}
