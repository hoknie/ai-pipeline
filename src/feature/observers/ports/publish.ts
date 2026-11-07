import type { Incident, RunState } from '../../runs/types/index.ts';

/** Tells the clients of the daemon about incidents and the observers. */
export interface ObserversPublishPort {
  /** A new incident of a run, told once. */
  incident(state: RunState, incident: Incident): void;
  /** The settings or the work of the observers may look different. */
  observersChanged(): void;
  /** The view of a run depends on the settings: it is sent again. */
  runChanged(state: RunState): void;
}
