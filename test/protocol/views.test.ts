import { describe, expect, it } from 'vitest';

import { addItem, advance, emptyQueue, startQueue, transition } from '../../src/core/index.ts';
import {
  formatRepositories,
  queueView,
  repositoryViews,
  runView,
} from '../../src/protocol/index.ts';
import { CONFIG_TEXT, finish, group, run, step } from '../core/helpers.ts';

const SPLIT_CONFIG = CONFIG_TEXT.replace(
  '    feature:\n      steps:',
  '    feature:\n      split: { specialist: plan, max_groups: 3 }\n      steps:',
);

function inRepository(path: string, id: string, options: Parameters<typeof run>[1] = {}) {
  const state = run(1, { id, ...options });
  state.run.repository = path;
  return state;
}

describe('repositoryViews', () => {
  const entries = [
    { path: '/b', addedAt: 2 },
    { path: '/a', addedAt: 1 },
    { path: '/c', addedAt: 3 },
  ];

  it('counts unfinished and waiting runs and queued tasks, sorted by path', () => {
    const waiting = inRepository('/a', 'run00000000a');
    step(waiting);
    finish(waiting, 'needs_human', { feedback: 'вопрос?' });
    const active = inRepository('/a', 'run00000000b');
    const done = inRepository('/b', 'run00000000c');
    transition(done, { kind: 'cancel', group: null }, 10);
    const queue = emptyQueue('/b', 1);
    addItem(queue, { workflow: 'feature', task: 'x' }, 'q1', 2);
    addItem(queue, { workflow: 'feature', task: 'y' }, 'q2', 3);
    const views = repositoryViews(entries, [waiting, active, done], [queue]);
    expect(views.map((view) => view.path)).toEqual(['/a', '/b', '/c']);
    expect(views[0]).toMatchObject({ unfinished: 2, waiting: 1, queued: 0 });
    expect(views[1]).toMatchObject({ unfinished: 0, waiting: 0, queued: 2 });
    expect(views[2]).toMatchObject({ unfinished: 0, waiting: 0, queued: 0 });
  });

  it('renders a table', () => {
    expect(formatRepositories([])).toBe('No repositories yet.');
    expect(
      formatRepositories([{ path: '/repo/app', addedAt: 1, unfinished: 2, waiting: 1, queued: 0 }]),
    ).toBe(
      ['REPOSITORY  UNFINISHED  WAITING  QUEUED', '/repo/app   2           1        0'].join('\n'),
    );
  });
});

describe('queueView', () => {
  const lookup = (state: ReturnType<typeof run>) => (id: string) =>
    id === state.run.id ? state : undefined;

  it('shows progress and the step of an active group', () => {
    const state = run(3);
    step(state);
    finish(state, 'done', { slug: 'gruppa-1' });
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    group(state, 'gruppa-1').status = 'merged';
    const view = queueView(queue, lookup(state)).runs[0]!;
    expect(view).toMatchObject({
      workflow: 'feature',
      createdAt: 1000,
      groups: { done: 1, total: 3 },
      delivering: false,
    });
    expect(view.active.length).toBeGreaterThan(0);
    expect(view.active.every((entry) => entry.step !== null)).toBe(true);
  });

  it('marks a finished run that waits for delivery', () => {
    const state = run(1);
    group(state).status = 'merged';
    group(state).delivery.state = 'pending';
    state.run.finishedAt = 5000;
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    const view = queueView(queue, lookup(state)).runs[0]!;
    expect(view).toMatchObject({ groups: { done: 1, total: 1 }, active: [], delivering: true });
  });

  it('shows a question to a human as a problem without stopping the queue', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    startQueue(queue, [], 2);
    advance(queue, [state], 3);
    const view = queueView(queue, lookup(state));
    expect(view.runs[0]!.problem).toMatchObject({ reason: 'needs_human', group: 'gruppa-1' });
    expect(view.stop).toBeNull();
    expect(view.status).toBe('running');
  });

  it('reports 0/0 groups while the task is split', () => {
    const state = run(1, { split: true, configText: SPLIT_CONFIG });
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    expect(queueView(queue, lookup(state)).runs[0]!.groups).toEqual({ done: 0, total: 0 });
  });
});

describe('automatic delivery in views', () => {
  it('reports the setting of the repository and the choice of each item', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x', autoDeliver: false }, 'q1', 2);
    addItem(queue, { workflow: 'feature', task: 'y' }, 'q2', 2);
    const view = queueView(queue, () => undefined, true);
    expect(view.autoDeliver).toBe(true);
    expect(view.items.map((item) => item.autoDeliver)).toEqual([false, null]);
    expect(queueView(queue, () => undefined).autoDeliver).toBeNull();
  });
});

describe('tags in views', () => {
  const catalog = [
    { id: 'tg-a', name: 'auth', color: 'blue' as const, createdAt: 1 },
    { id: 'tg-b', name: 'v2', color: 'red' as const, createdAt: 2 },
  ];

  it('shows the tags of a run in order and drops dangling ids', () => {
    const state = run(1);
    state.run.tags = ['tg-b', 'gone', 'tg-a'];
    expect(runView(state, 1000, undefined, catalog).tags).toEqual([
      { id: 'tg-b', name: 'v2', color: 'red' },
      { id: 'tg-a', name: 'auth', color: 'blue' },
    ]);
    expect(runView(state, 1000).tags).toEqual([]);
  });

  it('shows the tags of queue items and of queue runs', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x', tags: ['tg-a', 'gone'] }, 'q1', 2);
    const started = run(1);
    started.run.tags = ['tg-b'];
    queue.runs.push(started.run.id);
    const view = queueView(queue, () => started, null, catalog);
    expect(view.items[0]!.tags).toEqual([{ id: 'tg-a', name: 'auth', color: 'blue' }]);
    expect(view.runs[0]!.tags).toEqual([{ id: 'tg-b', name: 'v2', color: 'red' }]);
  });
});
