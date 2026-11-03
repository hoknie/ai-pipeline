import type { RunView } from '../../types.ts';

/** Whether merged groups wait for delivery and none is being delivered now. */
export function canDeliver(run: RunView): boolean {
  return run.delivery.merged > run.delivery.applied && !run.delivery.inProgress;
}

export type DeliveryBadge = {
  status: 'running' | 'apply_failed' | 'pending' | 'applied';
  /** Which dictionary label to use; `null` takes the label of the status. */
  label: 'delivering' | 'deliveryFailed' | 'delivery' | null;
  /** Why the delivery failed. */
  reason: string | null;
};

/** The single delivery status of a run for its header, or `null` while nothing is merged. */
export function deliveryBadge(run: RunView): DeliveryBadge | null {
  const { delivery } = run;
  if (delivery.inProgress) return { status: 'running', label: 'delivering', reason: null };
  if (delivery.failed > 0) {
    return {
      status: 'apply_failed',
      label: 'deliveryFailed',
      reason:
        run.deliveryStage?.status === 'apply_failed' ? (run.deliveryStage.reason ?? null) : null,
    };
  }
  if (delivery.merged > delivery.applied) {
    return { status: 'pending', label: 'delivery', reason: null };
  }
  if (delivery.merged > 0) return { status: 'applied', label: null, reason: null };
  return null;
}
