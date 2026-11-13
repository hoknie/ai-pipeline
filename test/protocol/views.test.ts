import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUTOPILOT_ANSWER,
  addItem,
  advance,
  emptyQueue,
  pauseRun,
  startQueue,
} from '../../src/feature/queue/types/index.ts';
import {
  type ObserverSettings,
  type RepairPolicy,
  type RuntimeUnavailable,
  repairPolicy,
  defaultObserverSettings,
  repairIncidents,
} from '../../src/feature/observers/types/index.ts';
import { dispatch, transition } from '../../src/feature/runs/machine/index.ts';
import type { GroupWait } from '../../src/feature/runs/types/index.ts';
import { formatRepositories } from '../../src/presentation/format/index.ts';
import {
  groupView,
  observersView,
  pickSpecChange,
  catalogView,
  queueView,
  repositoryViews,
  runView,
  systemGroups,
  withQueue,
} from '../../src/presentation/ipc/views/index.ts';
import { CONFIG_TEXT, finish, group, run, step } from '../feature/runs/helpers.ts';

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
  const project = { name: null, slug: null, enabled: true, color: null };
  const entries = [
    { path: '/b', addedAt: 2, ...project },
    { path: '/a', addedAt: 1, ...project },
    { path: '/c', addedAt: 3, ...project },
  ];

  it('counts unfinished and waiting runs and queued tasks, sorted by path', () => {
    const waiting = inRepository('/a', 'run00000000a');
    step(waiting);
    finish(waiting, 'needs_human', { feedback: 'вопрос?' });
    const active = inRepository('/a', 'run00000000b');
    const done = inRepository('/b', 'run00000000c');
    transition(done, { kind: 'cancel', group: null }, 10);
    const queue = emptyQueue('/b', 1);
    addItem(queue, { pipeline: 'feature', task: 'x' }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'y' }, 'q2', 3);
    const views = repositoryViews(entries, [waiting, active, done], [queue]);
    expect(views.map((view) => view.path)).toEqual(['/a', '/b', '/c']);
    expect(views[0]).toMatchObject({ unfinished: 2, waiting: 1, queued: 0 });
    expect(views[1]).toMatchObject({ unfinished: 0, waiting: 0, queued: 2 });
    expect(views[2]).toMatchObject({ unfinished: 0, waiting: 0, queued: 0 });
  });

  it('carries the attributes of a project and its label', () => {
    const [named, plain] = repositoryViews(
      [
        { path: '/work/app', addedAt: 1, name: 'Shop', slug: 'app', enabled: false, color: 'teal' },
        { path: '/work/shop-api', addedAt: 2, ...project },
      ],
      [],
      [],
    );
    expect(named).toMatchObject({
      name: 'Shop',
      label: 'Shop',
      slug: 'app',
      enabled: false,
      color: 'teal',
    });
    expect(plain).toMatchObject({ name: null, label: 'shop-api', enabled: true, color: null });
  });

  it('writes the home directory as ~ in displayPath', () => {
    const list = [
      { path: '/Users/me', addedAt: 1, ...project },
      { path: '/Users/me/projects/shop', addedAt: 2, ...project },
      { path: '/Users/me2/shop', addedAt: 3, ...project },
      { path: '/srv/app', addedAt: 4, ...project },
    ];
    const shown = (home: string | null) =>
      repositoryViews(list, [], [], home).map((view) => view.displayPath);
    expect(shown('/Users/me')).toEqual(['~', '~/projects/shop', '/Users/me2/shop', '/srv/app']);
    expect(shown(null)).toEqual([
      '/Users/me',
      '/Users/me/projects/shop',
      '/Users/me2/shop',
      '/srv/app',
    ]);
  });

  it('renders a table', () => {
    expect(formatRepositories([])).toBe('No repositories yet.');
    expect(
      formatRepositories([
        {
          path: '/repo/app',
          displayPath: '/repo/app',
          addedAt: 1,
          name: 'Shop',
          label: 'Shop',
          slug: 'app',
          enabled: true,
          color: null,
          unfinished: 2,
          waiting: 1,
          queued: 0,
        },
        {
          path: '/repo/lib',
          displayPath: '/repo/lib',
          addedAt: 2,
          name: null,
          label: 'lib',
          slug: 'lib',
          enabled: false,
          color: null,
          unfinished: 0,
          waiting: 0,
          queued: 0,
        },
      ]),
    ).toBe(
      [
        'SLUG  NAME  REPOSITORY  STATE  UNFINISHED  WAITING  QUEUED',
        'app   Shop  /repo/app   on     2           1        0',
        'lib   lib   /repo/lib   off    0           0        0',
      ].join('\n'),
    );
  });
});

describe('task numbers in views', () => {
  it('carries the number of the run, of the queue item and of the predecessors', () => {
    const queue = emptyQueue('/repo', 1, 5);
    addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'B', after: ['q1', 'r'] }, 'q2', 2);
    const working = run(1, { id: 'r' });
    working.run.number = 3;
    const view = queueView(queue, (id) => (id === 'r' ? working : undefined));
    expect(view.items.map((item) => item.number)).toEqual([5, 6]);
    expect(view.items[1]!.after.map((dependency) => dependency.number)).toEqual([5, 3]);
    expect(runView(working, 1).number).toBe(3);
    const lost = queueView(queue, () => undefined);
    expect(lost.items[1]!.after[1]!.number).toBeNull();
  });
});

describe('queueView dependencies', () => {
  it('shows the readiness and the predecessors with their state', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'API', title: 'API' }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'UI', after: ['q1', 'run00000000a'] }, 'q2', 2);
    addItem(queue, { pipeline: 'feature', task: 'free' }, 'q3', 2);
    const working = run(1, { id: 'run00000000a' });
    const view = queueView(queue, (id) => (id === working.run.id ? working : undefined));
    expect(view.items.map((item) => item.readiness)).toEqual(['ready', 'waiting', 'ready']);
    expect(view.items[1]!.after).toEqual([
      { kind: 'item', id: 'q1', number: 1, title: 'API', state: 'waiting' },
      { kind: 'run', id: 'run00000000a', number: 1, title: 'задача 1', state: 'waiting' },
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
      pipeline: 'feature',
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
      current: { step: 'code', name: 'Кодировщик', number: 2 },
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

  it('does not show a failed observer step on a run that still works', () => {
    const state = run(1);
    step(state);
    state.repair = { ...group(state), slug: '_repair', status: 'failed' };
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    const card = queueView(queue, lookup(state)).runs[0]!;
    expect(card.state).toBe('active');
    expect(card.system).toEqual([]);
    expect(card.active.length).toBeGreaterThan(0);
    state.repair = { ...group(state), slug: '_repair', status: 'running' };
    expect(queueView(queue, lookup(state)).runs[0]!.system).toEqual([
      { kind: 'repair', status: 'running' },
    ]);
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
    expect(view).toMatchObject({
      autopilot: false,
      autoAnswer: false,
      skipFailed: false,
      skipped: [],
    });
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

  it('marks a skipped run returnable only when something can be retried', () => {
    const failed = run(1, { id: 'a' });
    step(failed);
    group(failed).status = 'failed';
    const merged = run(1, { id: 'b' });
    step(merged);
    group(merged).status = 'merged';
    group(merged).delivery = { ...group(merged).delivery, state: 'apply_failed' };
    const queue = emptyQueue('/repo', 1);
    queue.skipped = ['a', 'b'];
    const view = queueView(queue, (id) => (id === 'a' ? failed : id === 'b' ? merged : undefined));
    expect(view.skipped.map((card) => [card.id, card.returnable])).toEqual([
      ['a', true],
      ['b', false],
    ]);
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
    addItem(queue, { pipeline: 'feature', task: 'x', autoDeliver: false }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'y' }, 'q2', 2);
    const view = queueView(queue, () => undefined, true);
    expect(view.autoDeliver).toBe(true);
    expect(view.items.map((item) => item.autoDeliver)).toEqual([false, null]);
    expect(queueView(queue, () => undefined).autoDeliver).toBeNull();
  });
});

describe('tags in views', () => {
  const catalog = [
    {
      id: 'tg-a',
      repository: '/repo',
      name: 'auth',
      color: 'blue' as const,
      createdAt: 1,
      task: null,
    },
    {
      id: 'tg-b',
      repository: '/repo',
      name: 'v2',
      color: 'red' as const,
      createdAt: 2,
      task: null,
    },
  ];

  it('shows the tags of a run in order and drops dangling ids', () => {
    const state = run(1);
    state.run.tags = ['tg-b', 'gone', 'tg-a'];
    expect(runView(state, 1000, undefined, catalog).tags).toEqual([
      { id: 'tg-b', repository: '/repo', name: 'v2', color: 'red', task: null },
      { id: 'tg-a', repository: '/repo', name: 'auth', color: 'blue', task: null },
    ]);
    expect(runView(state, 1000).tags).toEqual([]);
  });

  it('shows the source task of a linked tag in every view', () => {
    const linked = {
      id: 'tg-l',
      repository: '/repo',
      name: 'cards',
      color: 'indigo' as const,
      createdAt: 3,
      task: { run: 'r1', number: 115 },
    };
    const state = run(1);
    state.run.tags = ['tg-l'];
    const expected = {
      id: 'tg-l',
      repository: '/repo',
      name: 'cards',
      color: 'indigo',
      task: { run: 'r1', number: 115 },
    };
    expect(runView(state, 1000, undefined, [linked]).tags).toEqual([expected]);
    expect(catalogView([linked])).toEqual([expected]);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-l'] }, 'q1', 2);
    expect(queueView(queue, () => undefined, null, [linked]).items[0]!.tags).toEqual([expected]);
  });

  it('shows the tags of queue items and of queue runs', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-a', 'gone'] }, 'q1', 2);
    const started = run(1);
    started.run.tags = ['tg-b'];
    queue.runs.push(started.run.id);
    const view = queueView(queue, () => started, null, catalog);
    expect(view.items[0]!.tags).toEqual([
      { id: 'tg-a', repository: '/repo', name: 'auth', color: 'blue', task: null },
    ]);
    expect(view.runs[0]!.tags).toEqual([
      { id: 'tg-b', repository: '/repo', name: 'v2', color: 'red', task: null },
    ]);
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
        name: 'Кодировщик',
        level: 'project',
        max: 1,
        running: [
          {
            slug: 'gruppa-1',
            title: 'Группа 1',
            step: 'code',
            stepName: 'Кодировщик',
            startedAt: 1500,
          },
        ],
        waiting: [{ slug: 'gruppa-2', title: 'Группа 2', step: 'code', stepName: 'Кодировщик' }],
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

describe('artifact counters in rows', () => {
  it('is 0 without counters and takes the count of the group slug', () => {
    const state = run(2);
    expect(runView(state, 5000).groups.map((row) => row.artifacts)).toEqual([0, 0]);
    const counts = new Map([[state.groups[1]!.slug, { count: 3, revision: 9 }]]);
    const view = runView(state, 5000, undefined, [], undefined, counts);
    expect(view.groups.map((row) => row.artifacts)).toEqual([0, 3]);
    expect(view.groups.map((row) => row.artifactsRevision)).toEqual([0, 9]);
  });

  it('puts the count into the row of a service step', () => {
    const state = run(1);
    state.split = { ...group(state), slug: '_split', status: 'merged', attempts: [] };
    const view = runView(
      state,
      5000,
      undefined,
      [],
      undefined,
      new Map([['_split', { count: 2, revision: 7 }]]),
    );
    expect(view.system[0]?.artifacts).toBe(2);
  });
});

describe('accepted answers in rows and the run view', () => {
  const answer = (by: 'human' | 'autopilot', n: number) => ({
    stepId: 'plan',
    question: `q${n}`,
    answer: `a${n}`,
    by,
  });

  it('copies the answers of a group into its row, oldest first', () => {
    const state = run(1);
    const target = state.groups[0]!;
    target.decisions.push(answer('human', 1), answer('autopilot', 2));
    const row = runView(state, 5000).groups[0]!;
    expect(row.decisions).toEqual(target.decisions);
    expect(row.decisions[0]).not.toBe(target.decisions[0]);
  });

  it('puts the answers of a service step into its row', () => {
    const state = run(1);
    state.split = { ...group(state), slug: '_split', status: 'merged', attempts: [] };
    state.split.decisions.push(answer('human', 1));
    expect(runView(state, 5000).system[0]?.decisions).toEqual([answer('human', 1)]);
  });

  it('lists the answers of the run in the order split, groups, message, resolve', () => {
    const state = run(2);
    const base = group(state);
    state.split = { ...base, slug: '_split', status: 'merged', attempts: [], decisions: [] };
    state.message = { ...base, slug: '_message', status: 'running', attempts: [], decisions: [] };
    state.resolve = { ...base, slug: '_resolve', status: 'running', attempts: [], decisions: [] };
    state.resolve.decisions.push(answer('autopilot', 4));
    state.message.decisions.push(answer('human', 3));
    state.groups[1]!.decisions.push(answer('autopilot', 2));
    state.groups[0]!.decisions.push(answer('human', 1));
    state.split.decisions.push(answer('human', 0));
    const view = runView(state, 5000);
    expect(view.decisions.map((d) => [d.group, d.question, d.by])).toEqual([
      ['_split', 'q0', 'human'],
      [state.groups[0]!.slug, 'q1', 'human'],
      [state.groups[1]!.slug, 'q2', 'autopilot'],
      ['_message', 'q3', 'human'],
      ['_resolve', 'q4', 'autopilot'],
    ]);
  });

  it('is empty without answers', () => {
    const view = runView(run(1), 5000);
    expect(view.decisions).toEqual([]);
    expect(view.groups[0]?.decisions).toEqual([]);
  });
});

describe('queueView delivery mode and autopilot answer', () => {
  it('shows the mode of the repository and of the items, and the answer text', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', deliveryMode: 'commit' }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'b' }, 'q2', 2);
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

describe('a message to the specialist in the views', () => {
  it('shows the message an attempt continued with and the attempt being interrupted', () => {
    const state = run(1);
    step(state);
    const seq = group(state).attempts.at(-1)!.seq;
    const before = groupView(state, group(state), '/w', null, 2500).attempts[0];
    expect(before).toMatchObject({ message: null, interrupting: false });
    transition(state, { kind: 'message', group: 'gruppa-1', seq, text: 'проверь OAuth' }, 2600);
    const during = groupView(state, group(state), '/w', null, 2700).attempts[0];
    expect(during).toMatchObject({ interrupting: true, reason: 'interrupted by a message' });
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq,
        exit: { sessionId: 's', usage: null, failure: null, outsideChanges: [] },
      },
      2800,
    );
    dispatch([state], 2900);
    const [first, second] = groupView(state, group(state), '/w', null, 3000).attempts;
    expect(first).toMatchObject({ status: 'cancelled', interrupting: false, message: null });
    expect(second).toMatchObject({
      interrupting: false,
      message: { text: 'проверь OAuth', at: 2600 },
    });
  });
});

describe('a group waiting for a usage limit', () => {
  function limited(onLimit: 'wait' | 'stop') {
    const state = run(1);
    step(state);
    const seq = group(state).attempts.at(-1)!.seq;
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq,
        exit: {
          sessionId: 's',
          usage: null,
          failure: { kind: 'usage_limit', resetsAt: 50_000 },
          outsideChanges: [],
          onLimit,
        },
      },
      2000,
    );
    return state;
  }

  it('shows when the waiting group may start again', () => {
    const state = limited('wait');
    const view = runView(state, 3000);
    expect(view.groups[0]).toMatchObject({ status: 'queued', limitUntil: 50_000 });
    expect(groupView(state, group(state), '/w', null, 3000).limitUntil).toBe(50_000);
  });

  it('shows no wait for a group failed on the limit', () => {
    const state = limited('stop');
    expect(runView(state, 3000).groups[0]).toMatchObject({ status: 'failed', limitUntil: null });
  });
});

describe('live usage in views', () => {
  const live = { inputTokens: 1200, outputTokens: 300, costUsd: null };

  it('counts the usage of a running attempt in the queue card, the run and the group row', () => {
    const state = run(1);
    step(state);
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    expect(queueView(queue, () => state).runs[0]!.usage).toBeNull();
    transition(
      state,
      { kind: 'attempt_usage', updates: [{ group: 'gruppa-1', seq: 1, usage: live }] },
      2000,
    );
    expect(queueView(queue, () => state).runs[0]!.usage).toEqual(live);
    const view = runView(state, 3000);
    expect(view.usage).toEqual(live);
    expect(view.groups[0]!.usage).toEqual(live);
  });
});

describe('waiting groups in views', () => {
  const specialistWait: GroupWait = {
    reason: 'specialist',
    specialist: 'coder',
    name: 'Coder',
    max: 1,
  };
  const only =
    (slug: string, wait: GroupWait) =>
    (_run: string, candidate: string): GroupWait | null =>
      candidate === slug ? wait : null;

  it('shows a group waiting for a busy specialist as waiting, the run stays active', () => {
    const state = run(2, { max: 1 });
    dispatch([state], 1500);
    const view = runView(state, 5000, () => null, [], only('gruppa-2', specialistWait));
    expect(view.groups[1]).toMatchObject({ status: 'waiting', wait: specialistWait });
    expect(view.groups[0]).toMatchObject({ status: 'running', wait: null });
    expect(view.state).toBe('active');
    expect(view.counts).toBe('waiting 1 · running 1');
    expect(groupView(state, group(state, 'gruppa-1'), '/w', null, 5000).wait).toBeNull();
  });

  it('shows the full swarm as capacity', () => {
    const state = run(2);
    const wait: GroupWait = { reason: 'capacity', max: 1 };
    const view = runView(
      state,
      5000,
      () => null,
      [],
      () => wait,
    );
    expect(view.groups.map((row) => row.status)).toEqual(['waiting', 'waiting']);
    expect(view.counts).toBe('waiting 2');
    const single = groupView(state, group(state), '/w', null, 5000, null, () => wait);
    expect(single).toMatchObject({ status: 'waiting', wait });
  });

  it('shows a waiting system step and puts it on the topology', () => {
    const state = run(1, { split: true, configText: SPLIT_CONFIG });
    const wait: GroupWait = { reason: 'capacity', max: 0 };
    const view = runView(state, 5000, () => null, [], only('_split', wait));
    expect(view.system[0]).toMatchObject({ kind: 'split', status: 'waiting', wait });
    expect(view.split).toMatchObject({ status: 'waiting', wait });
    expect(view.topology.split?.status).toBe('waiting');
  });

  it('puts the waiting group on the step of the topology', () => {
    const state = run(1);
    const view = runView(
      state,
      5000,
      () => null,
      [],
      () => specialistWait,
    );
    expect(view.topology.steps.flatMap((entry) => entry.groups.map((g) => g.status))).toEqual([
      'waiting',
    ]);
  });

  it('is unchanged without waits', () => {
    const state = run(2);
    expect(runView(state, 5000).groups.map((row) => row.status)).toEqual(['queued', 'queued']);
    expect(runView(state, 5000).counts).toBe('queued 2');
  });

  it('shows waiting and system steps on the card of a run of the queue', () => {
    const state = run(1, { split: true, configText: SPLIT_CONFIG });
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    const card = queueView(
      queue,
      () => state,
      null,
      [],
      null,
      () => ({ reason: 'specialist', specialist: 'plan', name: 'Plan', max: 1 }),
    ).runs[0]!;
    expect(card.system).toEqual([{ kind: 'split', status: 'waiting' }]);
    expect(card.waiting).toEqual([
      {
        group: '_split',
        step: 'split',
        stepName: 'Планировщик',
        wait: { reason: 'specialist', specialist: 'plan', name: 'Plan', max: 1 },
      },
    ]);
  });
});

describe('the delivery stage', () => {
  function merged(failedReason: string | null) {
    const state = run(1);
    const first = group(state);
    first.status = 'merged';
    if (failedReason !== null) {
      first.delivery = { ...first.delivery, state: 'apply_failed', reason: failedReason };
    }
    return state;
  }

  it('is null while nothing is merged', () => {
    expect(runView(run(1), 5000).deliveryStage).toBeNull();
    expect(
      queueView(
        (() => {
          const queue = emptyQueue('/repo', 1);
          queue.runs.push('run000000001');
          return queue;
        })(),
        () => run(1),
      ).runs[0]!.delivery,
    ).toBeNull();
  });

  it('is failed with the reason when a patch does not apply and no resolver ran', () => {
    const state = merged('does not exist in index');
    const view = runView(state, 5000);
    expect(view.system).toEqual([]);
    expect(view.deliveryStage).toEqual({
      status: 'apply_failed',
      reason: 'does not exist in index',
      groups: ['gruppa-1'],
    });
  });

  it('is pending for a merged group, applied once delivered and delivering meanwhile', () => {
    const state = merged(null);
    expect(runView(state, 5000).deliveryStage).toEqual({ status: 'pending' });
    group(state).delivery = { ...group(state).delivery, state: 'applied' };
    expect(runView(state, 5000).deliveryStage).toEqual({ status: 'applied', manual: false });
    group(state).delivery = { ...group(state).delivery, manual: true };
    expect(runView(state, 5000).deliveryStage).toEqual({ status: 'applied', manual: true });
    group(state).delivery = { ...group(state).delivery, manual: false };
    state.run.pendingDelivery = { round: 1, conflicts: [] } as never;
    expect(runView(state, 5000).deliveryStage).toEqual({ status: 'delivering' });
  });

  it('gives the time of the last delivery attempt of the run and of the group', () => {
    const state = merged('boom');
    expect(runView(state, 5000).delivery.finishedAt).toBeNull();
    group(state).delivery = { ...group(state).delivery, finishedAt: 4200 };
    expect(runView(state, 5000).delivery.finishedAt).toBe(4200);
    expect(groupView(state, group(state), '/w', null, 5000).delivery.finishedAt).toBe(4200);
  });

  it('shows the failed delivery on the card of the run of the queue', () => {
    const state = merged('boom');
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    expect(queueView(queue, () => state).runs[0]!.delivery).toBe('apply_failed');
  });
});

describe('run steps', () => {
  it('lists the steps with their state and skip flag', () => {
    const state = run(1);
    state.run.skippedSteps = ['qa'];
    step(state);
    finish(state, 'done');
    expect(runView(state, 1000).steps).toEqual([
      { id: 'plan', specialist: 'plan', name: 'Планировщик', skipped: false, state: 'done' },
      { id: 'code', specialist: 'coder', name: 'Кодировщик', skipped: false, state: 'active' },
      { id: 'review', specialist: 'reviewer', name: 'Ревьюер', skipped: false, state: 'upcoming' },
      { id: 'qa', specialist: 'qa', name: 'Тестировщик', skipped: true, state: 'upcoming' },
    ]);
  });
});

describe('a run waiting in the queue', () => {
  const view = (finished: boolean, state: 'failed' | 'active') => ({
    ...runView(run(1), 1000),
    finished,
    state,
  });

  it('shows a finished run as queued and keeps the item', () => {
    expect(withQueue(view(true, 'failed'), 'q9')).toMatchObject({
      state: 'queued',
      queueItem: 'q9',
      finished: true,
    });
  });

  it('keeps the state of an unfinished run', () => {
    expect(withQueue(view(false, 'active'), 'q9')).toMatchObject({
      state: 'active',
      queueItem: 'q9',
    });
  });

  it('shows a held run as paused, finished or not', () => {
    const held = { ...view(true, 'failed'), hold: 'paused' as const };
    expect(withQueue(held, 'q9')).toMatchObject({ state: 'failed', queueItem: 'q9' });
    const state = run(1);
    expect(runView(state, 1000).hold).toBeNull();
    state.run.hold = 'paused';
    expect(runView(state, 1000)).toMatchObject({ state: 'paused', hold: 'paused' });
  });

  it('keeps needs_human for a held run with a question', () => {
    const state = run(1);
    step(state);
    group(state).status = 'needs_human';
    state.run.hold = 'paused';
    expect(runView(state, 1000)).toMatchObject({ state: 'needs_human', hold: 'paused' });
  });

  it('takes the hold of a queue item from its run', () => {
    const state = run(1);
    const queue = emptyQueue('/repo', 1);
    pauseRun(queue, state, 'q1', 2);
    state.run.hold = 'paused';
    const found = queueView(queue, (id) => (id === state.run.id ? state : undefined));
    expect(found.items[0]).toMatchObject({ id: 'q1', hold: 'paused' });
  });

  it('changes nothing without an item', () => {
    const failed = view(true, 'failed');
    expect(withQueue(failed, null)).toEqual(failed);
    expect(failed.queueItem).toBeNull();
  });
});

describe('human names of steps in views', () => {
  const lookup = (state: ReturnType<typeof run>) => (id: string) =>
    id === state.run.id ? state : undefined;

  it('names the step in the row of a group, the attempt and the active group of the queue', () => {
    const state = run(1);
    step(state);
    const view = runView(state, 2000);
    expect(view.groups[0]).toMatchObject({ step: 'plan', stepName: 'Планировщик' });
    const detail = groupView(state, state.groups[0]!, '/w', null, 2000);
    expect(detail.attempts[0]).toMatchObject({ stepId: 'plan', stepName: 'Планировщик' });
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    expect(queueView(queue, lookup(state)).runs[0]!.active).toEqual([
      { group: 'gruppa-1', step: 'plan', stepName: 'Планировщик' },
    ]);
  });

  it('has no name for a group without attempts', () => {
    const state = run(1);
    expect(runView(state, 2000).groups[0]).toMatchObject({ step: null, stepName: null });
  });

  it('takes the name from the configuration of the run, not from a later one', () => {
    const state = run(1);
    step(state);
    (state.run.config.specialists.find((item) => item.slug === 'plan') as { name: string }).name =
      'Аналитик';
    expect(runView(state, 2000).groups[0]?.stepName).toBe('Аналитик');
  });
});

describe('runView progress', () => {
  it('counts the steps passed by the groups', () => {
    const state = run(1);
    step(state);
    finish(state, 'done', { slug: 'gruppa-1' });
    step(state);
    expect(runView(state, 2000).progress).toEqual({ done: 1, total: 4 });
  });

  it('does not lower after the reviewer sends the work back', () => {
    const state = run(1);
    for (let index = 0; index < 2; index += 1) {
      step(state);
      finish(state, 'done', { slug: 'gruppa-1' });
    }
    step(state);
    const before = runView(state, 2000).progress.done;
    finish(state, 'rejected', { slug: 'gruppa-1', feedback: 'переделать' });
    expect(runView(state, 2000).progress).toEqual({ done: before, total: 4 });
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    const view = queueView(queue, (id) => (id === state.run.id ? state : undefined)).runs[0]!;
    expect(view.steps.done).toBe(before);
  });

  it('is empty while the task is split', () => {
    const state = run(1);
    state.groups = [];
    expect(runView(state, 2000).progress).toEqual({ done: 0, total: 0 });
  });

  it('is complete for a merged run', () => {
    const state = run(1);
    group(state).status = 'merged';
    const { done, total } = runView(state, 2000).progress;
    expect(done).toBe(total);
    expect(total).toBeGreaterThan(0);
  });
});

describe('runView liveDiff', () => {
  const stat = (files: [string, number, number][]) => ({
    files: files.map(([path, added, removed]) => ({ path, added, removed })),
    added: files.reduce((sum, file) => sum + file[1], 0),
    removed: files.reduce((sum, file) => sum + file[2], 0),
    revision: 'aaa..bbb',
  });

  it('counts a running group before the merge', () => {
    const state = run(1);
    step(state);
    const diffs = () =>
      stat([
        ['a.ts', 300, 0],
        ['b.ts', 67, 0],
      ]);
    const view = runView(state, 2000, diffs);
    expect(view.diff).toBeNull();
    expect(view.liveDiff).toEqual({ files: 2, added: 367, removed: 0 });
  });

  it('counts a file shared by two groups once', () => {
    const state = run(2);
    group(state, 'gruppa-1').status = 'merged';
    const diffs = (slug: string) =>
      slug === 'gruppa-1'
        ? stat([['a.ts', 5, 1]])
        : stat([
            ['a.ts', 2, 0],
            ['b.ts', 3, 0],
          ]);
    expect(runView(state, 2000, diffs).liveDiff).toEqual({ files: 2, added: 10, removed: 1 });
  });

  it('skips cancelled groups', () => {
    const state = run(2);
    group(state, 'gruppa-2').status = 'cancelled';
    const diffs = (slug: string) =>
      slug === 'gruppa-1' ? stat([['a.ts', 1, 0]]) : stat([['b.ts', 9, 9]]);
    expect(runView(state, 2000, diffs).liveDiff).toEqual({ files: 1, added: 1, removed: 0 });
  });

  it('is null without statistics', () => {
    expect(runView(run(2), 2000).liveDiff).toBeNull();
  });

  it('skips a group without statistics instead of zeroing the sum', () => {
    const state = run(2);
    const diffs = (slug: string) => (slug === 'gruppa-1' ? stat([['a.ts', 4, 2]]) : null);
    expect(runView(state, 2000, diffs).liveDiff).toEqual({ files: 1, added: 4, removed: 2 });
  });
});

describe('frozen runs in views', () => {
  const active = (id: string) => {
    const state = run(1, { id });
    step(state);
    return state;
  };

  it('names the run a priority action would freeze, only when every place is taken', () => {
    const [a, b] = [active('a'), active('b')];
    const queue = emptyQueue('/repo', 1);
    queue.parallel = 2;
    queue.runs = ['a', 'b'];
    queue.priority = ['a'];
    const lookup = (id: string) => [a, b].find((state) => state.run.id === id);
    const full = queueView(queue, lookup);
    expect(full.freezeCandidate).toBe('b');
    expect(full.runs.map((card) => card.priority)).toEqual([true, false]);
    queue.parallel = 3;
    expect(queueView(queue, lookup).freezeCandidate).toBeNull();
    queue.parallel = 1;
    queue.priority = ['a', 'b'];
    expect(queueView(queue, lookup).freezeCandidate).toBeNull();
  });

  it('shows a frozen run as frozen with its hold on the item', () => {
    const state = active('b');
    state.run.hold = 'frozen';
    expect(runView(state, 1000)).toMatchObject({ state: 'frozen', hold: 'frozen' });
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'B' }, 'q1', 2);
    queue.items[0]!.run = 'b';
    const view = queueView(queue, (id) => (id === 'b' ? state : undefined));
    expect(view.items[0]).toMatchObject({ run: 'b', hold: 'frozen' });
  });

  it('shows a frozen run that failed as frozen, not queued', () => {
    const state = active('b');
    group(state).status = 'failed';
    state.run.finishedAt = 5;
    state.run.hold = 'frozen';
    const frozen = runView(state, 1000);
    expect(frozen).toMatchObject({ state: 'frozen', finished: true });
    expect(withQueue(frozen, 'q9')).toMatchObject({ state: 'frozen', queueItem: 'q9' });
  });
});

describe('name of the pipeline in views', () => {
  const named = CONFIG_TEXT.replace('    feature:\n', '    feature:\n      name: Новая функция\n');

  it('takes the name of a run from its snapshot and the id without a name', () => {
    expect(runView(run(1, { configText: named }), 1).pipelineName).toBe('Новая функция');
    expect(runView(run(1), 1).pipelineName).toBe('feature');
  });

  it('gives the name to the cards and items of the queue through the lookup', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2);
    addItem(queue, { pipeline: 'gone', task: 'B' }, 'q2', 2);
    const working = run(1, { id: 'r', configText: named });
    queue.runs.push('r');
    const names = (id: string) => (id === 'feature' ? 'Новая функция' : id);
    const view = queueView(
      queue,
      (id) => (id === 'r' ? working : undefined),
      null,
      [],
      null,
      undefined,
      names,
    );
    expect(view.items.map((item) => item.pipelineName)).toEqual(['Новая функция', 'gone']);
    expect(view.runs[0]?.pipelineName).toBe('Новая функция');
    expect(queueView(queue, () => undefined).items[0]?.pipelineName).toBe('feature');
  });
});

describe('statuses of the groups of a held run', () => {
  it('shows a queued group of a held run as its hold, without a wait', () => {
    const state = run(1);
    state.run.hold = 'frozen';
    const wait: GroupWait = { reason: 'capacity', max: 1 };
    const view = runView(state, 1000, undefined, [], () => wait);
    expect(view.groups[0]).toMatchObject({ status: 'frozen', hold: 'frozen', wait: null });
    expect(view.counts).toBe('frozen 1');
    state.run.hold = 'paused';
    const paused = runView(state, 1000);
    expect(paused.groups[0]).toMatchObject({ status: 'paused', hold: 'paused' });
    expect(paused.counts).toBe('paused 1');
  });

  it('keeps a running group running and takes the hold in the topology and the system rows', () => {
    const state = run(1, { configText: SPLIT_CONFIG, split: true });
    step(state, 1000);
    state.run.hold = 'frozen';
    const view = runView(state, 2000);
    expect(view.split).toMatchObject({ status: 'running' });
    const queued = run(2);
    step(queued, 1000);
    finish(queued, 'done', { now: 2000 });
    queued.run.hold = 'frozen';
    const held = runView(queued, 3000);
    const first = held.groups.find((row) => row.slug === 'gruppa-1')!;
    expect(first).toMatchObject({ status: 'frozen', hold: 'frozen' });
    const running = held.groups.find((row) => row.slug === 'gruppa-2')!;
    expect(running).toMatchObject({ status: 'running', hold: 'frozen' });
    const onTopology = held.topology.steps.flatMap((item) => item.groups);
    expect(onTopology.find((item) => item.slug === 'gruppa-1')?.status).toBe('frozen');
    expect(onTopology.find((item) => item.slug === 'gruppa-2')?.status).toBe('running');
  });

  it('shows a queued split step of a held run as its hold', () => {
    const state = run(1, { configText: SPLIT_CONFIG, split: true });
    state.run.hold = 'paused';
    const view = runView(state, 1000);
    expect(view.split).toMatchObject({ status: 'paused', wait: null });
    expect(view.system[0]).toMatchObject({ kind: 'split', status: 'paused', hold: 'paused' });
    expect(view.topology.split?.status).toBe('paused');
  });

  it('has no hold on a row of a run without one', () => {
    const state = run(1);
    const wait: GroupWait = { reason: 'capacity', max: 1 };
    const view = runView(state, 1000, undefined, [], () => wait);
    expect(view.groups[0]).toMatchObject({ status: 'waiting', hold: null });
    expect(view.clockStoppedAt).toBeNull();
  });
});

describe('the clock of a held run', () => {
  const heldAfterStep = () => {
    const state = run(1);
    step(state, 1000);
    finish(state, 'done', { now: 3000 });
    return state;
  };

  it('stops at the end of the last attempt once nothing runs', () => {
    const state = heldAfterStep();
    state.run.hold = 'frozen';
    expect(runView(state, 9000).clockStoppedAt).toBe(3000);
  });

  it('runs while an attempt is under way', () => {
    const state = run(1);
    step(state, 1000);
    state.run.hold = 'frozen';
    expect(runView(state, 9000).clockStoppedAt).toBeNull();
  });

  it('runs without a hold', () => {
    expect(runView(heldAfterStep(), 9000).clockStoppedAt).toBeNull();
  });

  it('runs when the held run has no attempt yet', () => {
    const state = run(1);
    state.run.hold = 'paused';
    expect(runView(state, 9000).clockStoppedAt).toBeNull();
  });

  it('runs while a delivery is in progress or a group merges', () => {
    const merging = heldAfterStep();
    merging.run.hold = 'frozen';
    group(merging).status = 'merging';
    expect(runView(merging, 9000).clockStoppedAt).toBeNull();
    const delivering = heldAfterStep();
    delivering.run.hold = 'frozen';
    delivering.run.pendingDelivery = {
      round: 1,
      conflicts: [],
    } as unknown as typeof delivering.run.pendingDelivery;
    expect(runView(delivering, 9000).clockStoppedAt).toBeNull();
  });
});

describe('pickSpecChange', () => {
  it('ignores paths outside the changes and nested spec files', () => {
    expect(
      pickSpecChange([
        'src/a.ts',
        'openspec/specs/x/spec.md',
        'openspec/changes/add/specs/x/spec.md',
        'openspec/changes/add/adr/y.md',
        'openspec/changes/add/notes.md',
      ]),
    ).toEqual([]);
  });

  it('puts active changes before archived ones, then orders by name', () => {
    const picked = pickSpecChange([
      'openspec/changes/archive/2026-11-04-old/tasks.md',
      'openspec/changes/zeta/tasks.md',
      'openspec/changes/alpha/design.md',
      'openspec/changes/alpha/tasks.md',
    ]);
    expect(picked).toEqual([
      { change: 'alpha', path: 'openspec/changes/alpha' },
      { change: 'zeta', path: 'openspec/changes/zeta' },
      { change: '2026-11-04-old', path: 'openspec/changes/archive/2026-11-04-old' },
    ]);
  });
});

describe('catalog view', () => {
  it('sorts by repository, then by name ignoring case', () => {
    const tag = (id: string, repository: string, name: string) => ({
      id,
      repository,
      name,
      color: 'blue' as const,
      createdAt: 1,
      task: null,
    });
    const view = catalogView([
      tag('1', '/b', 'alpha'),
      tag('2', '/a', 'Zeta'),
      tag('3', '/a', 'beta'),
    ]);
    expect(view.map((entry) => [entry.repository, entry.name])).toEqual([
      ['/a', 'beta'],
      ['/a', 'Zeta'],
      ['/b', 'alpha'],
    ]);
  });
});

describe('a pause stopping the running attempt in the views', () => {
  it('marks the attempt as interrupting and shows the reason once it is cancelled', () => {
    const state = run(1);
    step(state);
    const seq = group(state).attempts.at(-1)!.seq;
    transition(state, { kind: 'hold', hold: 'paused' }, 2600);
    const during = groupView(state, group(state), '/w', null, 2700).attempts[0];
    expect(during).toMatchObject({ interrupting: true, status: 'running' });
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq,
        exit: { sessionId: 's', usage: null, failure: null, outsideChanges: [] },
      },
      2800,
    );
    const [first] = groupView(state, group(state), '/w', null, 3000).attempts;
    expect(first).toMatchObject({
      status: 'cancelled',
      interrupting: false,
      reason: 'interrupted by a pause',
    });
    expect(runView(state, 3000)).toMatchObject({ state: 'paused', hold: 'paused' });
  });
});

describe('groupRow diffRevision', () => {
  it('carries the revision of the known statistics', () => {
    const state = run(1);
    const diff = {
      files: [{ path: 'a.ts', added: 1, removed: 0 }],
      added: 1,
      removed: 0,
      revision: 'aaa..bbb',
    };
    const row = runView(state, 2000, () => diff).groups[0];
    expect(row?.diffRevision).toBe('aaa..bbb');
    expect(row?.diff).toEqual({ files: 1, added: 1, removed: 0 });
  });

  it('is null without statistics', () => {
    expect(runView(run(1), 2000).groups[0]?.diffRevision).toBeNull();
  });
});

describe('pipeline actions in the views', () => {
  const ACTIONS_CONFIG = `swarm:
  specialists:
    plan: { name: Планировщик }
    coder: { name: Кодировщик }
  actions:
    prepare: { run: make, name: Подготовка }
    lint: { run: lint }
    commit: { run: commit }
  stages:
    before_split: [prepare]
    before_delivery: [lint]
    after_delivery: [commit]
  pipelines:
    feature:
      split: { specialist: plan }
      steps:
        - { id: code, specialist: coder }
`;

  function withActions() {
    const state = run(1, { split: true, configText: ACTIONS_CONFIG });
    return state;
  }

  it('lists the actions in the order they run, with the point and the id', () => {
    const state = withActions();
    const base = state.actions[0]!;
    state.message = { ...base, slug: '_message', status: 'running', attempts: [] };
    const after = { ...base, slug: '_action-after-delivery-commit', attempts: [] };
    const before = { ...base, slug: '_action-before-delivery-lint', attempts: [] };
    state.actions.push(before, after);
    const view = runView(state, 5000);
    expect(
      view.system.map((row) => [row.kind, row.slug, row.point ?? null, row.action ?? null]),
    ).toEqual([
      ['action', '_action-before-split-prepare', 'before_split', 'prepare'],
      ['split', '_split', null, null],
      ['action', '_action-before-delivery-lint', 'before_delivery', 'lint'],
      ['message', '_message', null, null],
      ['action', '_action-after-delivery-commit', 'after_delivery', 'commit'],
    ]);
  });

  it('does not count the actions among the groups', () => {
    const state = withActions();
    const view = runView(state, 5000);
    expect(view.groups).toHaveLength(0);
    expect(view.counts).toBe('');
    expect(view.total).toBe(0);
    expect(view.progress.total).toBe(0);
  });

  it('shows an action by its name in the row and the stage list', () => {
    const state = withActions();
    const view = runView(state, 5000);
    expect(view.system[0]).toMatchObject({ kind: 'action', title: 'Подготовка', status: 'queued' });
    expect(view.topology.stages.map((stage) => stage.id)).toEqual([
      'action:before_split:prepare',
      'split',
      'step:code',
      'merge',
      'action:before_delivery:lint',
      'delivery',
      'action:after_delivery:commit',
      'cleanup',
    ]);
    expect(view.topology.stages[0]).toMatchObject({
      status: 'queued',
      group: '_action-before-split-prepare',
    });
  });

  it('puts a waiting action on its stage', () => {
    const state = withActions();
    const view = runView(
      state,
      5000,
      () => null,
      [],
      (_run, slug) =>
        slug === '_action-before-split-prepare' ? { reason: 'capacity', max: 1 } : null,
    );
    expect(view.system[0]?.status).toBe('waiting');
    expect(view.topology.stages[0]?.status).toBe('waiting');
  });

  it('puts the actions on the card of a run of the queue without the delivery hold', () => {
    const state = withActions();
    state.run.hold = 'paused';
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    const card = queueView(
      queue,
      () => state,
      null,
      [],
      null,
      () => null,
    ).runs[0]!;
    expect(card.system).toEqual([
      { kind: 'action', status: 'paused', title: expect.any(String) },
      { kind: 'split', status: 'paused' },
    ]);
  });

  it('shows the group view of an action on the branch of the run', () => {
    const state = withActions();
    const action = state.actions[0]!;
    const view = groupView(state, action, '/w', null, 5000);
    expect(view.branch).toBe(state.run.branch);
    expect(view.slug).toBe('_action-before-split-prepare');
  });
});

describe('observers in views', () => {
  const observerSettings = (patch: Partial<ObserverSettings> = {}): ObserverSettings => ({
    ...defaultObserverSettings(),
    enabled: true,
    projects: [{ repository: '/repo', maxWorkers: null }],
    ...patch,
  });
  const observers = (
    patch: Partial<ObserverSettings> = {},
    unavailable?: RuntimeUnavailable,
  ): RepairPolicy => repairPolicy(observerSettings(patch), unavailable);
  const failedRun = (id = 'run00000000a') => {
    const state = inRepository('/repo', id);
    step(state);
    const failed = group(state);
    failed.status = 'failed';
    failed.reason = 'сломалось';
    return state;
  };
  const incident = { key: 'k1', kind: 'failed', group: 'gruppa-1', detail: 'сломалось' } as const;

  it('shows a failed task an observer may take as repair', () => {
    const state = failedRun();
    expect(runView(state, 1000, undefined, [], undefined, undefined, observers())).toMatchObject({
      state: 'repair',
      repair: { allowed: true, active: true, repairs: 0, incident: null, cancelReason: null },
    });
  });

  it('keeps the failure of a task the observer will not take', () => {
    const state = failedRun();
    const off = runView(state, 1000);
    expect(off.state).toBe('failed');
    expect(off.repair).toMatchObject({ active: false });
    state.run.repair.allowed = false;
    expect(runView(state, 1000, undefined, [], undefined, undefined, observers()).state).toBe(
      'failed',
    );
    state.run.repair.allowed = true;
    state.run.repair.repairs = 5;
    expect(
      runView(state, 1000, undefined, [], undefined, undefined, observers()).repair?.active,
    ).toBe(false);
    state.run.repair.repairs = 0;
    expect(
      runView(state, 1000, undefined, [], undefined, undefined, observers({ projects: [] })).state,
    ).toBe('failed');
  });

  it('does not show repair for a group whose runtime is still unavailable', () => {
    const state = failedRun();
    const attempt = group(state).attempts.at(-1);
    if (attempt) attempt.reason = { kind: 'runtime_disabled', runtime: attempt.runtime };
    const view = runView(
      state,
      1000,
      undefined,
      [],
      undefined,
      undefined,
      observers({}, () => true),
    );
    expect(view.state).toBe('failed');
    expect(view.repair?.active).toBe(false);
    const enabled = runView(state, 1000, undefined, [], undefined, undefined, observers());
    expect(enabled.repair?.active).toBe(true);
  });

  it('shows a task with an incident being repaired as repair, even with observers off', () => {
    const state = failedRun();
    state.run.repair.incident = incident;
    expect(runView(state, 1000)).toMatchObject({
      state: 'repair',
      repair: { active: true, incident },
    });
  });

  it('ends the repair view when the incident is cleared', () => {
    const state = failedRun();
    state.run.repair.incident = incident;
    state.run.repair.taken = repairIncidents(state).map((found) => found.key);
    state.run.repair.incident = null;
    const view = runView(state, 1000, undefined, [], undefined, undefined, observers());
    expect(view.state).toBe('failed');
    expect(view.repair).toMatchObject({ active: false, incident: null });
  });

  it('puts a hold before repair, and repair before needs_human', () => {
    const state = failedRun();
    state.run.repair.incident = incident;
    state.run.hold = 'paused';
    expect(runView(state, 1000).state).toBe('paused');
    state.run.hold = 'frozen';
    expect(runView(state, 1000).state).toBe('frozen');
    state.run.hold = null;
    group(state).status = 'needs_human';
    expect(runView(state, 1000).state).toBe('repair');
  });

  it('keeps repair when the task has a return item', () => {
    const state = failedRun();
    const view = runView(state, 1000, undefined, [], undefined, undefined, observers());
    expect(withQueue(view, 'q9')).toMatchObject({ state: 'repair', queueItem: 'q9' });
  });

  it('lists the repair group in system after the resolver', () => {
    const state = failedRun();
    state.resolve = { ...group(state), slug: '_resolve' };
    state.repair = { ...group(state), slug: '_repair', status: 'running' };
    expect(runView(state, 1000).system.map((row) => row.kind)).toEqual(['resolve', 'repair']);
    expect(systemGroups(state).map((entry) => entry.kind)).toEqual(['resolve', 'repair']);
  });

  it('shows why the observer cancelled the task', () => {
    const state = failedRun();
    state.run.repair.cancelReason = 'задача невыполнима';
    expect(runView(state, 1000).repair?.cancelReason).toBe('задача невыполнима');
  });

  it('keeps the observer as the author of a decision and of an attempt', () => {
    const state = run(1);
    step(state);
    group(state).decisions.push({
      stepId: 'code',
      question: 'Продолжать?',
      answer: 'Да',
      by: 'observer',
      attemptSeq: 1,
    });
    const view = runView(state, 1000);
    expect(view.decisions.map((d) => d.by)).toEqual(['observer']);
    const found = groupView(state, group(state), '/w', null, 5000);
    expect(found.attempts[0]?.decision?.by).toBe('observer');
  });

  it('counts repairs under way and tasks waiting for an observer', () => {
    const repairing = failedRun('run00000000a');
    repairing.run.repair.incident = incident;
    const waiting = failedRun('run00000000b');
    const idle = inRepository('/repo', 'run00000000c');
    const settings = observerSettings();
    const view = observersView(settings, [repairing, waiting, idle], observers());
    expect(view.settings).toBe(settings);
    expect(view.workers).toEqual({
      running: [{ runId: 'run00000000a', repository: '/repo', incident }],
      waiting: 1,
    });
    expect(
      observersView(defaultObserverSettings(), [waiting], repairPolicy(defaultObserverSettings()))
        .workers.waiting,
    ).toBe(0);
  });
});
