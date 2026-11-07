import type { ObserverSettings } from '../../../../feature/observers/types/index.ts';
import type { Incident } from '../../../../feature/runs/types/index.ts';
import type { FieldError } from '../../../../feature/swarm-config/types/index.ts';

/** Observers as the settings page shows them: the settings and the repairs under way or waiting. */
export interface ObserversView {
  settings: ObserverSettings;
  workers: {
    running: { runId: string; repository: string; incident: Incident }[];
    waiting: number;
  };
}

/** The result of `observers_set`: the stored view, or the errors of the values by field. */
export type ObserversSetResult =
  { ok: true; view: ObserversView } | { ok: false; reason: 'invalid'; errors: FieldError[] };
