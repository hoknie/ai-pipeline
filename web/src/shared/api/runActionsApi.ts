import type { ApplyResult, QueueView, RunView } from './types.ts';
import { enc, post, withRepository } from './http.ts';

export interface RunActionsApi {
  answer(runId: string, group: string, answer: string): Promise<unknown>;
  /** Interrupts the running attempt `seq`; the step continues in its session with the text. */
  message(runId: string, group: string, seq: number, text: string): Promise<unknown>;
  /** `refreshConfig` first takes the specialists of the current configuration into the run. */
  retry(runId: string, group: string, options?: { refreshConfig?: boolean }): Promise<unknown>;
  /** Skips a step of the run (or brings it back with `skip=false`); returns the run. */
  skipStep(runId: string, step: string, skip: boolean): Promise<unknown>;
  cancel(runId: string, group?: string): Promise<unknown>;
  apply(runId: string, force: boolean): Promise<ApplyResult>;
  /** Marks merged groups delivered after the user merged them by hand; nothing is applied. */
  markDelivered(runId: string, groups?: string[]): Promise<ApplyResult>;
  /** Replaces the title of a run in any state; the name stays. */
  setRunTitle(runId: string, title: string): Promise<RunView>;
  /** Adds and removes tags (by name) of a run in any state. */
  setRunTags(runId: string, change: { add?: string[]; remove?: string[] }): Promise<RunView>;
  /** Pauses an unfinished run: its running step stops (it continues in the same session) and the run goes to the end of the queue. */
  pauseRun(run: string, repository: string): Promise<QueueView & { item: string }>;
}

export function runActionsApi(): RunActionsApi {
  return {
    answer: (runId, group, answer) =>
      post(`/api/runs/${enc(runId)}/groups/${enc(group)}/answer`, { answer }),
    message: (runId, group, seq, text) =>
      post(`/api/runs/${enc(runId)}/groups/${enc(group)}/message`, { seq, text }),
    retry: (runId, group, options) =>
      post(
        `/api/runs/${enc(runId)}/groups/${enc(group)}/retry`,
        options?.refreshConfig ? { refreshConfig: true } : {},
      ),
    skipStep: (runId, step, skip) => post(`/api/runs/${enc(runId)}/skip`, { step, skip }),
    cancel: (runId, group) =>
      group
        ? post(`/api/runs/${enc(runId)}/groups/${enc(group)}/cancel`)
        : post(`/api/runs/${enc(runId)}/cancel`),
    apply: (runId, force) => post(`/api/runs/${enc(runId)}/apply`, force ? { force: true } : {}),
    markDelivered: (runId, groups) =>
      post(`/api/runs/${enc(runId)}/delivered`, groups ? { groups } : {}),
    setRunTitle: (runId, title) => post(`/api/runs/${enc(runId)}/title`, { title }),
    setRunTags: (runId, change) => post(`/api/runs/${enc(runId)}/tags`, change),
    pauseRun: (run, runRepository) =>
      post(withRepository(`/api/runs/${enc(run)}/pause`, runRepository)),
  };
}
