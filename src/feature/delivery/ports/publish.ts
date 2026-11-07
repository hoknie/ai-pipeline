import type { RunState } from '../../runs/types/index.ts';

/** Tells the clients of the daemon that the diffs of a run changed. */
export interface DeliveryPublishPort {
  runChanged(state: RunState): void;
}
