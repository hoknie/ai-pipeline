import { describe, expect, it } from 'vitest';

import {
  activeRuns,
  attentionAction,
  attentionItems,
  createStyle,
  formatOverview,
  overviewJson,
  type OverviewData,
} from '../../src/presentation/format/index.ts';
import type {
  QueueView,
  RepositoryView,
  RunView,
} from '../../src/presentation/ipc/contract/index.ts';
import { runView } from '../../src/presentation/ipc/views/index.ts';
import { finish, run, step } from '../feature/runs/helpers.ts';

const DAEMON = { version: '1.2.3', pid: 4242, busy: false, network: 'up', panel: null } as const;

function data(
  runs: RunView[],
  projects: OverviewData['projects'] = [],
  repositories: RepositoryView[] = [],
): OverviewData {
  return { daemon: { ...DAEMON }, projects, repositories, runs };
}

function repository(slug: string, extra: Partial<RepositoryView> = {}): RepositoryView {
  return {
    path: '/repo',
    slug,
    label: slug,
    enabled: true,
    unfinished: 1,
    waiting: 0,
    queued: 0,
    ...extra,
  } as RepositoryView;
}

function queue(extra: Partial<QueueView> = {}): QueueView {
  return { status: 'running', parallel: 2, runs: [], stop: null, ...extra } as QueueView;
}

function asked(options: { humanOnly?: boolean } = {}): RunView {
  const state = run(1, { id: 'r1' });
  step(state, 1000);
  finish(state, 'needs_human', { feedback: 'OAuth или пароль?\nещё', ...options, now: 2000 });
  return runView(state, 3000);
}

function failedGroup(overrides: Partial<RunView> = {}): RunView {
  const view = asked();
  const groups = view.groups.map((group) => ({
    ...group,
    status: 'failed' as const,
    question: null,
    reason: 'tests red\nmore',
  }));
  return { ...view, id: 'r3', groups, ...overrides };
}

function merged(overrides: Partial<RunView> = {}): RunView {
  return {
    ...asked(),
    id: 'r9',
    number: 9,
    waiting: 0,
    groups: [],
    autoDeliver: false,
    delivery: { applied: 0, merged: 2, failed: 0, inProgress: false, finishedAt: null },
    ...overrides,
  };
}

describe('overview: items of attention', () => {
  it('is empty for an empty swarm', () => {
    const empty = data([]);
    expect(attentionItems(empty)).toEqual([]);
    expect(activeRuns(empty)).toEqual([]);
    expect(overviewJson(empty)).toEqual({ daemon: DAEMON, attention: [], projects: [], runs: [] });
  });

  it('finds the question of a group with its first line and the human mark', () => {
    const [item] = attentionItems(data([asked({ humanOnly: true })]));
    expect(item).toMatchObject({
      kind: 'question',
      runId: 'r1',
      number: 1,
      group: 'gruppa-1',
      text: 'OAuth или пароль?',
      humanOnly: 'request',
    });
    expect(attentionAction(item!)).toEqual({ kind: 'answer', runId: 'r1', group: 'gruppa-1' });
  });

  it('finds failed and conflicting groups of an unfinished run', () => {
    const failed = failedGroup({ finished: false });
    const conflict = {
      ...failed,
      id: 'r4',
      groups: failed.groups.map((group) => ({ ...group, status: 'conflict' as const })),
    };
    expect(attentionItems(data([failed, conflict])).map((item) => item.kind)).toEqual([
      'failed',
      'conflict',
    ]);
    expect(attentionItems(data([failed]))[0]).toMatchObject({
      text: 'tests red',
      group: 'gruppa-1',
    });
    expect(attentionAction(attentionItems(data([failed]))[0]!)).toEqual({
      kind: 'retry',
      runId: 'r3',
      group: 'gruppa-1',
    });
  });

  it('takes a failed group of a finished run only when it can be returned', () => {
    expect(attentionItems(data([failedGroup({ finished: true, returnable: true })]))).toHaveLength(
      1,
    );
    expect(attentionItems(data([failedGroup({ finished: true, returnable: false })]))).toEqual([]);
  });

  it('takes a manual delivery of a finished run, which is not an active run', () => {
    const view = merged({ finished: true });
    const [item] = attentionItems(data([view]));
    expect(item).toMatchObject({ kind: 'delivery', runId: 'r9', group: null });
    expect(attentionAction(item!)).toEqual({ kind: 'apply', runId: 'r9' });
    expect(overviewJson(data([view])).runs).toEqual([]);
    expect(overviewJson(data([view])).attention).toHaveLength(1);
  });

  it('skips a delivery that is automatic, done or under way', () => {
    expect(attentionItems(data([merged({ autoDeliver: true })]))).toEqual([]);
    const done = { applied: 2, merged: 2, failed: 0, inProgress: false, finishedAt: 1 };
    expect(attentionItems(data([merged({ delivery: done })]))).toEqual([]);
    const going = { ...done, applied: 0, inProgress: true };
    expect(attentionItems(data([merged({ delivery: going })]))).toEqual([]);
  });

  it('takes a failed delivery of a finished run with its reason', () => {
    const view = merged({
      finished: true,
      autoDeliver: true,
      deliveryStage: { status: 'apply_failed', reason: 'dirty tree\nmore', groups: ['a'] },
    });
    expect(attentionItems(data([view]))).toMatchObject([
      { kind: 'apply_failed', runId: 'r9', text: 'dirty tree' },
    ]);
  });

  it('resolves the slug of a project that is not in the summary', () => {
    const known = [repository('app', { path: asked().repository, unfinished: 0 })];
    const delivery = merged({ finished: true });
    const failed = merged({
      id: 'r8',
      finished: true,
      autoDeliver: true,
      deliveryStage: { status: 'apply_failed', reason: 'dirty', groups: ['a'] },
    });
    const items = attentionItems(data([delivery, failed], [], known));
    expect(items.map((item) => item.kind)).toEqual(['delivery', 'apply_failed']);
    expect(items.map((item) => item.repository)).toEqual(['app', 'app']);
    const active = { ...asked(), finished: false };
    expect(formatOverview(data([active], [], known), createStyle(false))).toMatch(/ app$/m);
  });

  it('takes a stopped queue by the slug of its project', () => {
    const stopped = queue({
      status: 'stopped',
      stop: { kind: 'item', item: 'q1', error: 'boom' },
    });
    const [item] = attentionItems(data([], [{ repository: repository('app'), queue: stopped }]));
    expect(item).toMatchObject({ kind: 'queue_stopped', repository: 'app', runId: null });
    expect(item!.text).toBe('item q1: boom');
    expect(attentionAction(item!)).toEqual({ kind: 'queue_start', repository: 'app' });
  });

  it('orders items by kind: questions, failures, deliveries, queues', () => {
    const stopped = queue({ stop: { kind: 'item', item: 'q1', error: 'boom' } });
    const all = data(
      [merged({ finished: true }), failedGroup({ finished: false }), asked()],
      [{ repository: repository('app'), queue: stopped }],
    );
    expect(attentionItems(all).map((item) => item.kind)).toEqual([
      'question',
      'failed',
      'delivery',
      'queue_stopped',
    ]);
  });

  it('lists only unfinished runs as active, the newest first', () => {
    const older = { ...asked(), id: 'old', createdAt: 1 };
    const newer = { ...asked(), id: 'new', createdAt: 5 };
    const done = { ...asked(), id: 'done', finished: true, createdAt: 9 };
    expect(activeRuns(data([older, done, newer])).map((view) => view.id)).toEqual(['new', 'old']);
  });
});

describe('overview: text', () => {
  const view = { ...asked(), progress: { done: 2, total: 6 } };
  const full = data([view], [{ repository: repository('app', { waiting: 1 }), queue: queue() }]);

  it('prints the daemon, Needs you, Projects and Runs without color', () => {
    const withPanel: OverviewData = {
      ...full,
      daemon: { ...DAEMON, panel: 'http://127.0.0.1:7341', network: 'down' },
    };
    const text = formatOverview(withPanel, createStyle(false));
    expect(text.split('\n')[0]).toBe(
      'aip 1.2.3 · daemon pid 4242 · idle · network down · panel http://127.0.0.1:7341',
    );
    expect(text).toContain('Needs you (1):');
    expect(text).toContain('  #1 r1 gruppa-1  question: OAuth или пароль?');
    expect(text).toMatch(/PROJECT\s+QUEUE\s+PLACES\s+RUNS\s+WAITING\s+QUEUED/);
    expect(text).toMatch(/app\s+running\s+0 of 2\s+1\s+1\s+0/);
    expect(text).toMatch(/#1 r1 {2}\S+ {2}feature .*2\/6 steps {2}app/);
    expect(text).not.toContain('    gruppa-1: ');
    expect(text.indexOf('Needs you')).toBeLessThan(text.indexOf('Projects:'));
    expect(text.indexOf('Projects:')).toBeLessThan(text.indexOf('Runs:'));
    expect(text).not.toContain('→');
    expect(text).not.toContain('\x1b');
  });

  it('lists the running groups under their run with the step', () => {
    const state = run(1, { id: 'r2' });
    step(state, 1000);
    const text = formatOverview(data([runView(state, 3000)]), createStyle(false));
    expect(text).toContain('\n    gruppa-1: Планировщик');
  });

  it('prints placeholders for an empty swarm', () => {
    const text = formatOverview(data([]), createStyle(false));
    expect(text).toBe(
      [
        'aip 1.2.3 · daemon pid 4242 · idle',
        'Needs you: nothing',
        'Projects: idle',
        'Runs: none active',
      ].join('\n\n'),
    );
  });

  it('marks a question for a person only', () => {
    const text = formatOverview(data([asked({ humanOnly: true })]), createStyle(false));
    expect(text).toContain('question (human only): OAuth или пароль?');
  });

  it('adds hints and the progress bar with color', () => {
    const text = formatOverview(full, createStyle(true));
    expect(text).toContain('→ aip group answer r1 gruppa-1 "<answer>"');
    expect(text).toContain('███');
    expect(text).toContain('2/6 steps');
    expect(text).toContain('\x1b[');
  });

  it('hints at the delivery and the stopped queue', () => {
    const stopped = queue({ stop: { kind: 'item', item: 'q1', error: 'boom' } });
    const text = formatOverview(
      data([merged({ finished: true })], [{ repository: repository('app'), queue: stopped }]),
      createStyle(true),
    );
    expect(text).toContain('→ aip run apply r9');
    expect(text).toContain('→ aip queue start --repo app');
  });
});
