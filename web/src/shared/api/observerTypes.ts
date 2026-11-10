import type { RunView, RunViewState, SystemStepKind } from './types.ts';

/**
 * The contract of the observers as the panel reads it. The panel is built next to the daemon, so
 * these types are described here instead of being taken from the daemon's: the build passes
 * whether or not the daemon types already carry the fields.
 */

/** What an observer was called for. */
export type IncidentKind = 'question' | 'failed' | 'conflict' | 'delivery';

export interface Incident {
  key: string;
  kind: IncidentKind;
  group: string;
  detail: string;
}

export interface ObserverProject {
  repository: string;
  /** Workers of the project; null: no limit of its own. */
  maxWorkers: number | null;
}

export interface ObserverSettings {
  enabled: boolean;
  /** 1..20 */
  workers: number;
  /** 1..50 */
  maxRepairs: number;
  projects: ObserverProject[];
  /** The fields of the observer's specialist, as in a specialist file. */
  specialist: Record<string, unknown>;
}

export interface ObserversView {
  settings: ObserverSettings;
  workers: {
    running: { runId: string; repository: string; incident: Incident }[];
    waiting: number;
  };
}

/** How the observer works in one run. */
export interface RunRepair {
  /** The observer may take the run. */
  allowed: boolean;
  /** The run is in the state `repair`. */
  active: boolean;
  repairs: number;
  incident: Incident | null;
  /** Why the observer cancelled the whole task; null when it did not. */
  cancelReason?: string | null;
}

/** The state of a run in the panel: the daemon's states and `repair`. */
export type PanelRunState = RunViewState | 'repair';

/** The kind of a service step in the panel: the daemon's kinds and `repair`. */
export type PanelStepKind = SystemStepKind | 'repair';

/** Who answered a question. */
export type PanelAuthor = 'human' | 'autopilot' | 'observer';

/** The repair data of a run; absent while the daemon does not send it. */
export function repairOf(run: RunView & { repair?: RunRepair }): RunRepair | null {
  return run.repair ?? null;
}

/** Whether the run is in the state `repair`. */
export const isRepairing = (run: RunView): boolean => repairOf(run)?.active === true;

/** The kind of a service step as the panel names it. */
export const stepKind = (row: { kind: SystemStepKind }): PanelStepKind => row.kind;

/** Whether the service step is the repair of the observer: it has no delivery of its own. */
export const isRepairStep = (row: { kind: SystemStepKind }): boolean => stepKind(row) === 'repair';

/** Who answered, as a key of the dictionaries: anyone but the autopilot and the observer is a human. */
export const authorOf = (by: string): PanelAuthor =>
  by === 'autopilot' || by === 'observer' ? by : 'human';

/** The answer of `PUT /api/observers`: the saved state, or the errors of fields. */
export type ObserversResult =
  { ok: true; view: ObserversView } | { ok: false; errors: { path: string; message: string }[] };

/** Reads the body of a stream event or an answer; null when it is not a view. */
export function parseObserversView(value: unknown): ObserversView | null {
  if (typeof value !== 'object' || value === null) return null;
  const { settings, workers } = value as Partial<ObserversView>;
  if (typeof settings !== 'object' || settings === null) return null;
  if (typeof workers !== 'object' || workers === null) return null;
  return {
    settings: {
      enabled: settings.enabled === true,
      workers: Number(settings.workers ?? 1),
      maxRepairs: Number(settings.maxRepairs ?? 1),
      projects: Array.isArray(settings.projects) ? settings.projects : [],
      specialist:
        typeof settings.specialist === 'object' && settings.specialist !== null
          ? settings.specialist
          : {},
    },
    workers: {
      running: Array.isArray(workers.running) ? workers.running : [],
      waiting: Number(workers.waiting ?? 0),
    },
  };
}
