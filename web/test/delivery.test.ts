import { describe, expect, it } from 'vitest';

import { applyOutcome, deliveryBadge, settledOutcome } from '../src/components/runs/delivery.ts';
import { groupView, runView } from './fixtures.ts';

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
      deliveryStage: status === 'applied' ? { status } : { status, reason: 'boom', groups: ['a'] },
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
