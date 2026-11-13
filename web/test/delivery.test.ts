import { describe, expect, it } from 'vitest';

import {
  applyOutcome,
  autoDeliveryCancellable,
  deliveryBadge,
  settledOutcome,
  undeliveredMark,
} from '../src/features/runs/header/delivery.ts';
import { groupRow, groupView, runView } from './fixtures.ts';

const withDelivery = (
  delivery: Partial<{
    applied: number;
    merged: number;
    failed: number;
    inProgress: boolean;
    finishedAt: number | null;
  }>,
  extra = {},
) =>
  runView({
    delivery: {
      applied: 0,
      merged: 0,
      failed: 0,
      inProgress: false,
      finishedAt: null,
      ...delivery,
    },
    ...extra,
  });

describe('autoDeliveryCancellable', () => {
  it('is true only for an unfinished run with auto delivery', () => {
    expect(autoDeliveryCancellable(runView({ autoDeliver: true, finished: false }))).toBe(true);
    expect(autoDeliveryCancellable(runView({ autoDeliver: false, finished: false }))).toBe(false);
    expect(autoDeliveryCancellable(runView({ autoDeliver: true, finished: true }))).toBe(false);
  });
});

describe('deliveryBadge', () => {
  it('prefers a running delivery over failures', () => {
    expect(deliveryBadge(withDelivery({ merged: 2, failed: 1, inProgress: true }))).toMatchObject({
      status: 'running',
      label: 'delivering',
    });
  });

  it('reports a failure with its reason', () => {
    const badge = deliveryBadge(
      withDelivery(
        { merged: 1, failed: 1 },
        { deliveryStage: { status: 'apply_failed', reason: 'boom', groups: ['a'] } },
      ),
    );
    expect(badge).toMatchObject({
      status: 'apply_failed',
      label: 'deliveryFailed',
      reason: 'boom',
    });
  });

  it('labels a delivery marked by hand', () => {
    const manual = withDelivery(
      { merged: 1, applied: 1 },
      { deliveryStage: { status: 'applied', manual: true } },
    );
    expect(deliveryBadge(manual)).toMatchObject({
      status: 'applied',
      label: 'deliveredManually',
    });
    const real = withDelivery(
      { merged: 1, applied: 1 },
      { deliveryStage: { status: 'applied', manual: false } },
    );
    expect(deliveryBadge(real)).toMatchObject({ status: 'applied', label: null });
  });

  it('reports undelivered merged groups as pending', () => {
    expect(deliveryBadge(withDelivery({ merged: 3, applied: 2 }))).toMatchObject({
      status: 'pending',
      label: 'delivery',
    });
  });

  it('has no reason when the failed delivery stage is not apply_failed', () => {
    const badge = deliveryBadge(
      withDelivery({ merged: 1, failed: 1 }, { deliveryStage: { status: 'pending' } }),
    );
    expect(badge).toMatchObject({ status: 'apply_failed', reason: null });
  });

  it('reports everything delivered', () => {
    expect(deliveryBadge(withDelivery({ merged: 3, applied: 3 }))?.status).toBe('applied');
  });

  it('has no badge while nothing is merged', () => {
    expect(deliveryBadge(withDelivery({}))).toBeNull();
  });
});

describe('applyOutcome', () => {
  const answer = (
    pending: boolean,
    state: 'applied' | 'apply_failed' | 'pending',
    reason = null,
  ) => ({
    runId: 'run1',
    pending,
    groups: [
      {
        slug: 'a',
        delivery: { ...groupView().delivery, state, reason, finishedAt: 1 },
      },
    ],
  });

  it('is pending while the delivery goes on', () => {
    expect(applyOutcome(answer(true, 'pending'))).toEqual({ kind: 'pending' });
    expect(applyOutcome({ runId: 'run1', pending: false, groups: [] })).toEqual({
      kind: 'pending',
    });
  });

  it('takes the outcome from the groups of the answer', () => {
    expect(applyOutcome(answer(false, 'applied'))).toEqual({ kind: 'applied' });
    expect(applyOutcome(answer(false, 'apply_failed', 'boom' as never))).toEqual({
      kind: 'failed',
      reason: 'boom',
    });
  });
});

describe('settledOutcome', () => {
  const watch = { since: 1000, failedBefore: true, busy: true };
  const stage = (status: 'applied' | 'apply_failed', finishedAt: number, inProgress = false) =>
    runView({
      delivery: { applied: 0, merged: 1, failed: 0, inProgress, finishedAt },
      deliveryStage:
        status === 'applied'
          ? { status, manual: false }
          : { status, reason: 'boom', groups: ['a'] },
    });

  it('waits while the delivery goes on', () => {
    expect(settledOutcome(stage('applied', 2000, true), watch)).toBeNull();
  });

  it('reports the outcome of a new attempt, also a repeated failure', () => {
    expect(settledOutcome(stage('applied', 2000), watch)).toEqual({ kind: 'applied' });
    expect(settledOutcome(stage('apply_failed', 2000), watch)).toEqual({
      kind: 'failed',
      reason: 'boom',
    });
  });

  it('reports a cancel only after the delivery was seen in progress', () => {
    expect(settledOutcome(stage('apply_failed', 1000), watch)).toEqual({ kind: 'cancelled' });
    expect(settledOutcome(stage('apply_failed', 1000), { ...watch, busy: false })).toBeNull();
  });
});

describe('undeliveredMark', () => {
  const merged = (diff: { files: number; added: number; removed: number } | null = null) =>
    groupRow({ status: 'merged', delivery: 'pending', diff });
  const run = (state: string, delivery = {}, groups = [merged()], extra = {}) =>
    withDelivery({ merged: 1, ...delivery }, { state, groups, ...extra });

  it('has no mark while a delivery goes on', () => {
    expect(undeliveredMark(run('finished', { inProgress: true, failed: 1 }))).toBeNull();
  });

  it('marks a failure with its reason in any state', () => {
    for (const state of ['active', 'needs_human', 'finished', 'failed', 'cancelled']) {
      const mark = undeliveredMark(
        run(state, { failed: 1 }, [merged()], {
          deliveryStage: { status: 'apply_failed', reason: 'boom', groups: ['a'] },
        }),
      );
      expect(mark).toMatchObject({ status: 'apply_failed', reason: 'boom' });
    }
  });

  it('marks a pending result only in stopped states', () => {
    for (const state of ['finished', 'failed', 'cancelled']) {
      expect(undeliveredMark(run(state))).toMatchObject({ status: 'undelivered' });
    }
    for (const state of ['active', 'needs_human', 'queued', 'paused', 'frozen']) {
      expect(undeliveredMark(run(state))).toBeNull();
    }
  });

  it('counts delivered groups for a partial delivery', () => {
    const mark = undeliveredMark(
      run('finished', { merged: 2, applied: 1 }, [
        merged(),
        groupRow({ slug: 'b', status: 'merged', delivery: 'applied' }),
      ]),
    );
    expect(mark).toMatchObject({ status: 'undelivered', delivered: 1, merged: 2 });
  });

  it('has no mark when all is delivered, also by hand, or nothing is merged', () => {
    const done = groupRow({ status: 'merged', delivery: 'applied' });
    expect(undeliveredMark(run('finished', { applied: 1 }, [done]))).toBeNull();
    expect(undeliveredMark(run('finished', { merged: 0 }, [groupRow()]))).toBeNull();
  });

  it('ignores a merged group known to have no files, but not an unknown diff', () => {
    expect(
      undeliveredMark(run('finished', {}, [merged({ files: 0, added: 0, removed: 0 })])),
    ).toBeNull();
    expect(undeliveredMark(run('finished', {}, [merged(null)]))).not.toBeNull();
    expect(
      undeliveredMark(run('finished', {}, [merged({ files: 2, added: 1, removed: 0 })])),
    ).not.toBeNull();
  });
});
