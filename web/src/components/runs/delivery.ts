import type { RunView } from '../../types.ts';

/** Whether merged groups wait for delivery and none is being delivered now. */
export function canDeliver(run: RunView): boolean {
  return run.delivery.merged > run.delivery.applied && !run.delivery.inProgress;
}
