import type { ApplyResult, RunView } from '../../types.ts';

/** Whether merged groups wait for delivery and none is being delivered now. */
export function canDeliver(run: RunView): boolean {
  return run.delivery.merged > run.delivery.applied && !run.delivery.inProgress;
}

export type DeliveryBadge = {
  status: 'running' | 'apply_failed' | 'pending' | 'applied';
  /** Which dictionary label to use; `null` takes the label of the status. */
  label: 'delivering' | 'deliveryFailed' | 'delivery' | 'deliveredManually' | null;
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
  if (delivery.merged > 0) {
    const manual = run.deliveryStage?.status === 'applied' && run.deliveryStage.manual;
    return { status: 'applied', label: manual ? 'deliveredManually' : null, reason: null };
  }
  return null;
}

export interface UndeliveredMark {
  status: 'apply_failed' | 'undelivered';
  /** Why the delivery failed; `null` for `undelivered`. */
  reason: string | null;
  /** Merged groups already delivered. */
  delivered: number;
  /** Merged groups in all. */
  merged: number;
}

const STOPPED = new Set(['finished', 'failed', 'cancelled']);

/** The mark of a run in the list whose result waits for a person, or `null`. */
export function undeliveredMark(run: RunView): UndeliveredMark | null {
  const { delivery } = run;
  if (delivery.inProgress) return null;
  const counts = { delivered: delivery.applied, merged: delivery.merged };
  if (delivery.failed > 0) {
    const reason =
      run.deliveryStage?.status === 'apply_failed' ? (run.deliveryStage.reason ?? null) : null;
    return { status: 'apply_failed', reason, ...counts };
  }
  if (!STOPPED.has(run.state)) return null;
  const waiting = run.groups.some(
    (group) => group.status === 'merged' && group.delivery === 'pending' && group.diff?.files !== 0,
  );
  return waiting ? { status: 'undelivered', reason: null, ...counts } : null;
}

/** What the answer of `apply` says about the delivery. */
export type ApplyOutcome =
  { kind: 'pending' } | { kind: 'applied' } | { kind: 'failed'; reason: string | null };

/** The outcome of a delivery from the answer of `apply`; `pending` while it still goes on. */
export function applyOutcome(result: ApplyResult): ApplyOutcome {
  if (result.pending) return { kind: 'pending' };
  const failed = result.groups.find((group) => group.delivery.state === 'apply_failed');
  if (failed) return { kind: 'failed', reason: failed.delivery.reason };
  if (result.groups.some((group) => group.delivery.state === 'applied')) {
    return { kind: 'applied' };
  }
  return { kind: 'pending' };
}

/** A delivery the panel started and waits for. */
export interface DeliveryWatch {
  /** `run.delivery.finishedAt` before the request. */
  since: number | null;
  /** Whether groups of the run were in `apply_failed` before the request. */
  failedBefore: boolean;
  /** The panel has seen the delivery in progress; only then an unchanged time means a cancel. */
  busy: boolean;
}

export type SettledOutcome = ApplyOutcome | { kind: 'cancelled' };

/** The outcome of a watched delivery by the run now; `null` while it goes on. */
export function settledOutcome(run: RunView, watch: DeliveryWatch): SettledOutcome | null {
  if (run.delivery.inProgress) return null;
  if (run.delivery.finishedAt === watch.since) return watch.busy ? { kind: 'cancelled' } : null;
  if (run.deliveryStage?.status === 'applied') return { kind: 'applied' };
  if (run.deliveryStage?.status === 'apply_failed') {
    return { kind: 'failed', reason: run.deliveryStage.reason ?? null };
  }
  return { kind: 'cancelled' };
}
