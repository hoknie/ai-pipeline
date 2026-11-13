import type { ObserverSettings, RepairPolicy } from '../../../feature/observers/types/index.ts';
import type { RunState } from '../../../feature/runs/types/index.ts';
import type { ObserversView } from '../contract/responses/observers.ts';
import { repairActive } from './runs.ts';

export function observersView(
  settings: ObserverSettings,
  states: readonly RunState[],
  policy: RepairPolicy,
): ObserversView {
  const running: ObserversView['workers']['running'] = [];
  let waiting = 0;
  for (const state of states) {
    const { incident } = state.run.repair;
    if (incident !== null) {
      running.push({ runId: state.run.id, repository: state.run.repository, incident });
    } else if (repairActive(state, policy)) {
      waiting += 1;
    }
  }
  return { settings, workers: { running, waiting } };
}
