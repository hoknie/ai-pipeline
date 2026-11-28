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

/**
 * The root of a chain of probes: the run whose task the probe works on, and the key of the probe
 * budget. A probe of a probe walks up the `probeOf` links to the main run. A run that is gone
 * cannot name its parent, so its own id becomes the key and the places of its probes stay
 * together. A cycle stops where it started.
 */
export function probeRootOf(
  lookup: (id: string) => { probeOf: string | null } | undefined,
  run: string,
): string {
  let current = run;
  const seen = new Set<string>([current]);
  for (;;) {
    const parent = lookup(current)?.probeOf ?? null;
    if (parent === null || seen.has(parent)) return current;
    seen.add(parent);
    current = parent;
  }
}

/** A short key of a value: FNV-1a over its JSON text. Not cryptography: it compares the saved runs of one experiment and protects nothing. */
export function probeKey(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * The input keys of a probe run: `context` names the part every probe of the experiment must
 * repeat (the project, pipeline, provider, base commit, task, groups and attachments), and
 * `config` names the variant with its resolved configuration, one per variant.
 */
export function probeInputKeys(state: RunState): { context: string; config: string } {
  const input = probeInputOf(state);
  const context = {
    repository: input.repository,
    pipeline: input.pipeline,
    provider: input.provider,
    baseCommit: input.baseCommit,
    task: input.task,
    groups: input.groups,
    attachments: input.attachments,
  };
  return {
    context: probeKey(context),
    config: probeKey({ variant: input.variant, config: input.config }),
  };
}

/** The harness fields of a new run: a main run of the full harness unless told otherwise. */
export function probeFields(run: {
  harness?: Harness | undefined;
  probeOf?: string | null | undefined;
}): { harness: Harness; probeOf: string | null } {
  return { harness: run.harness ?? DEFAULT_HARNESS, probeOf: run.probeOf ?? null };
}
