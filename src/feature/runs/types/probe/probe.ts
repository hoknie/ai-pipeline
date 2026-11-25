import type { ResolvedConfig } from '../../../swarm-config/types/index.ts';
import { DEFAULT_HARNESS, type Harness } from './harness.ts';
import type { RunAttachment, RunState } from '../run.ts';

/** A group of the task as the run was given it. */
export interface ProbeGroup {
  title: string;
  task: string;
}

/**
 * The part of a run that a probe must repeat exactly: where it starts, the task and the launch
 * configuration. The harness of the run is deliberately not here: it is the one thing a probe
 * changes.
 */
export interface ProbeInput {
  repository: string;
  pipeline: string;
  variant: string;
  provider: string | null;
  baseCommit: string;
  config: ResolvedConfig;
  /** The task of a run that splits it; an empty string for a run of prepared groups. */
  task: string;
  groups: ProbeGroup[];
  attachments: RunAttachment[];
}

/** The input of a run a probe repeats. */
export function probeInputOf(state: RunState): ProbeInput {
  const split = state.split;
  return {
    repository: state.run.repository,
    pipeline: state.run.pipeline,
    variant: state.run.variant,
    provider: state.run.provider,
    baseCommit: state.run.baseCommit,
    config: state.run.config,
    task: split?.task ?? (state.groups.length === 1 ? (state.groups[0]?.task ?? '') : ''),
    groups: split === null ? state.groups.map(({ title, task }) => ({ title, task })) : [],
    attachments: state.run.attachments.map((attachment) => ({ ...attachment })),
  };
}

/** Whether two runs start from the same input; the harness of each is what a probe compares. */
export function sameProbeInput(left: ProbeInput, right: ProbeInput): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The harness fields of a new run: a main run of the full harness unless told otherwise. */
export function probeFields(run: {
  harness?: Harness | undefined;
  probeOf?: string | null | undefined;
}): { harness: Harness; probeOf: string | null } {
  return { harness: run.harness ?? DEFAULT_HARNESS, probeOf: run.probeOf ?? null };
}
