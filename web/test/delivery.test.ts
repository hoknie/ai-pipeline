import { describe, expect, it } from 'vitest';

import { deliveryBadge } from '../src/components/runs/delivery.ts';
import { runView } from './fixtures.ts';

const withDelivery = (
  delivery: Partial<{ applied: number; merged: number; failed: number; inProgress: boolean }>,
  extra = {},
) =>
  runView({
    delivery: { applied: 0, merged: 0, failed: 0, inProgress: false, ...delivery },
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
