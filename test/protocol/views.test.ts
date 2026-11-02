import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUTOPILOT_ANSWER,
  addItem,
  advance,
  emptyQueue,
  startQueue,
  transition,
} from '../../src/core/index.ts';
import {
  formatRepositories,
  groupView,
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

describe('queueView dependencies', () => {
  it('shows the readiness and the predecessors with their state', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'API', title: 'API' }, 'q1', 2);
    addItem(queue, { workflow: 'feature', task: 'UI', after: ['q1', 'run00000000a'] }, 'q2', 2);
    addItem(queue, { workflow: 'feature', task: 'free' }, 'q3', 2);
    const working = run(1, { id: 'run00000000a' });
    const view = queueView(queue, (id) => (id === working.run.id ? working : undefined));
    expect(view.items.map((item) => item.readiness)).toEqual(['ready', 'waiting', 'ready']);
    expect(view.items[1]!.after).toEqual([
      { kind: 'item', id: 'q1', title: 'API', state: 'waiting' },
      { kind: 'run', id: 'run00000000a', title: 'задача 1', state: 'waiting' },
    ]);
    expect(view.items[2]!.after).toEqual([]);
    const lost = queueView(queue, () => undefined);
    expect(lost.items[1]!.readiness).toBe('blocked');
    expect(lost.items[1]!.after[1]).toMatchObject({ kind: 'run', state: 'blocked' });
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
      // gruppa-1 is merged (4 steps), gruppa-2 runs `plan`, gruppa-3 waits at the start
      steps: { done: 4, total: 12, current: null },
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
    expect(view).toMatchObject({
      groups: { done: 1, total: 1 },
      steps: { done: 4, total: 4, current: null },
      active: [],
      delivering: true,
    });
  });

  it('shows the step of a single group and no steps while the task is split', () => {
    const state = run(1);
    step(state);
    finish(state, 'done', { slug: 'gruppa-1' });
    step(state);
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    expect(queueView(queue, lookup(state)).runs[0]!.steps).toEqual({
      done: 1,
      total: 4,
      current: { step: 'code', number: 2 },
    });
    state.groups = [];
    expect(queueView(queue, lookup(state)).runs[0]!.steps).toEqual({
      done: 0,
      total: 0,
      current: null,
    });
  });

  it('shows a question to a human as a problem without stopping the queue', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    startQueue(queue, [], 2);
    advance(queue, [state], () => undefined, 3);
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

describe('queueView settings and skipped runs', () => {
  it('shows the settings and an empty skipped list of a new queue', () => {
    const view = queueView(emptyQueue('/repo', 1), () => undefined);
    expect(view).toMatchObject({ autopilot: false, skipFailed: false, skipped: [] });
  });

  it('shows a skipped run with its stopping problem and leaves it out of the places', () => {
    const state = run(1, { id: 'a' });
    step(state);
    group(state).status = 'failed';
    const queue = emptyQueue('/repo', 1);
    queue.skipFailed = true;
    queue.runs.push('a');
    startQueue(queue, [], 2);
    advance(queue, [state], (id) => (id === 'a' ? state : undefined), 3);
    const view = queueView(queue, (id) => (id === 'a' ? state : undefined));
    expect(view.skipFailed).toBe(true);
    expect(view.runs).toEqual([]);
    expect(view.skipped).toHaveLength(1);
    expect(view.skipped[0]).toMatchObject({
      id: 'a',
      problem: { reason: 'failed', group: 'gruppa-1' },
    });
  });

  it('shows the stopping problem of a skipped run before a question to a human', () => {
    const state = run(2, { id: 'a' });
    step(state);
    finish(state, 'needs_human', { slug: 'gruppa-1', feedback: 'q' });
    group(state, 'gruppa-2').status = 'conflict';
    const queue = emptyQueue('/repo', 1);
    queue.skipped = ['a'];
    const view = queueView(queue, (id) => (id === 'a' ? state : undefined));
    expect(view.skipped[0]!.problem).toEqual({ group: 'gruppa-2', reason: 'conflict' });
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

describe('runView specialists', () => {
  it('lists the specialists that run or are waited for', () => {
    const state = run(2, {
      configText: CONFIG_TEXT.replace('coder: {', 'coder: { max: 1,'),
    });
    expect(runView(state, 5000).specialists).toMatchObject([
      { specialist: 'plan', running: [], waiting: [{ slug: 'gruppa-1' }, { slug: 'gruppa-2' }] },
    ]);
    step(state);
    finish(state, 'done');
    finish(state, 'done', { slug: 'gruppa-2' });
    step(state);
    expect(runView(state, 5000).specialists).toEqual([
      {
        specialist: 'coder',
        level: 'project',
        max: 1,
        running: [{ slug: 'gruppa-1', title: 'Группа 1', step: 'code', startedAt: 1500 }],
        waiting: [{ slug: 'gruppa-2', title: 'Группа 2', step: 'code' }],
      },
    ]);
  });
});

describe('runView startedAt', () => {
  it('is null before the first attempt and the attempt start after it', () => {
    const state = run(1);
    expect(runView(state, 5000).startedAt).toBeNull();
    step(state, 1500);
    expect(runView(state, 5000).startedAt).toBe(1500);
  });
});

describe('runView system steps', () => {
  it('lists the split and the merged message step as done, apart from the groups', () => {
    const state = run(2);
    const base = group(state);
    state.split = { ...base, slug: '_split', status: 'merged', attempts: [] };
    state.message = { ...base, slug: '_message', status: 'merged', attempts: [] };
    const before = runView(run(2), 5000).counts;
    const view = runView(state, 5000);
    expect(view.groups).toHaveLength(2);
    expect(view.system.map((row) => [row.kind, row.slug, row.status])).toEqual([
      ['split', '_split', 'done'],
      ['message', '_message', 'done'],
    ]);
    expect(view.split?.status).toBe('done');
    expect(view.counts).toBe(before);
    expect(groupView(state, state.message, '/w', null, 5000).status).toBe('done');
  });

  it('keeps a failed resolver with its reason, after the message step', () => {
    const state = run(1);
    const base = group(state);
    state.resolve = { ...base, slug: '_resolve', status: 'failed', reason: 'boom', attempts: [] };
    state.message = { ...base, slug: '_message', status: 'running', attempts: [] };
    const view = runView(state, 5000);
    expect(view.system.map((row) => row.kind)).toEqual(['message', 'resolve']);
    expect(view.system[1]).toMatchObject({ status: 'failed', reason: 'boom' });
  });

  it('is empty without service groups', () => {
    expect(runView(run(1), 5000).system).toEqual([]);
  });
});

describe('queueView delivery mode and autopilot answer', () => {
  it('shows the mode of the repository and of the items, and the answer text', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'a', deliveryMode: 'commit' }, 'q1', 2);
    addItem(queue, { workflow: 'feature', task: 'b' }, 'q2', 2);
    const view = queueView(queue, () => undefined, true, [], 'branch');
    expect(view.deliveryMode).toBe('branch');
    expect(view.items.map((item) => item.deliveryMode)).toEqual(['commit', null]);
    expect(view.autopilotAnswer).toBeNull();
    expect(view.autopilotAnswerDefault).toBe(DEFAULT_AUTOPILOT_ANSWER);
    queue.autopilotAnswer = 'Согласен';
    expect(queueView(queue, () => undefined).autopilotAnswer).toBe('Согласен');
    expect(queueView(queue, () => undefined).deliveryMode).toBeNull();
  });

  it('shows the delivery mode of a run', () => {
    expect(runView(run(1, { deliveryMode: 'commit' }), 2000).deliveryMode).toBe('commit');
  });
});
