import { isRepairStep } from '../../../../shared/api/observerTypes.ts';
import type { GroupRow, SystemStepRow } from '../../../../shared/api/types.ts';

/** What the screen of a group or a system step offers. */
export function capabilities(
  row: GroupRow | SystemStepRow,
  deliverable: boolean,
  inProgress: boolean,
) {
  const system = 'kind' in row;
  // The split and an action of the pipeline have no delivery of their own: a retry retries the step.
  const delivery = system && row.kind !== 'split' && row.kind !== 'action' && !isRepairStep(row);
  const repair = system && isRepairStep(row);
  const stopped = row.status === 'failed' || row.status === 'cancelled';
  return {
    retry: !delivery && !repair && ['failed', 'cancelled', 'conflict'].includes(row.status),
    retryDelivery: delivery && stopped && (deliverable || inProgress),
    cancel: !['merged', 'done', 'failed', 'cancelled'].includes(row.status),
    changes: !system,
  };
}

export type Capabilities = ReturnType<typeof capabilities>;
