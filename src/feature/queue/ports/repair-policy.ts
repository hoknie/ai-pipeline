import type { RunState } from '../../runs/types/index.ts';

/** Whether an observer takes the incident of a run: then the queue does not stop for it. */
export interface RepairPolicyPort {
  takesIncident(state: RunState): boolean;
}
