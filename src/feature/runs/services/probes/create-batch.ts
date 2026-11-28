import { rejected } from '../../../../platform/errors/index.ts';
import type { ResolvedConfig } from '../../../swarm-config/types/index.ts';
import type {
  ProbeExperiment,
  ProbeLauncher,
  ProbeRunSpec,
  ProbeStates,
  RunState,
} from '../../types/index.ts';

/**
 * Creates the runs of one repetition of the experiment. The first repetition of a variant reads
 * `swarm.yaml` as the source did; every next one repeats the resolved configuration of the first
 * run of the same variant, so an edit of the file cannot change the input of a running
 * experiment. Every run belongs to the source run from the moment of creation.
 */
export async function createBatch(
  launcher: ProbeLauncher,
  states: ProbeStates,
  experiment: ProbeExperiment,
  specs: ProbeRunSpec[],
  source: RunState,
): Promise<void> {
  for (const spec of specs) {
    const reference = referenceOf(states, experiment, spec.candidate);
    const created = await launcher.createProbe({
      repository: experiment.repository,
      pipeline: experiment.pipeline,
      groupTitle: experiment.groupTitle,
      split: experiment.split,
      task: experiment.task,
      baseCommit: experiment.baseCommit,
      variant: spec.candidate,
      provider: experiment.provider,
      skip: [...experiment.skip],
      attachments: source.run.attachments.map((attachment) => ({ ...attachment })),
      number: source.run.number,
      title: `probe ${spec.candidate} ${spec.repetition}`,
      probeOf: experiment.sourceRun,
      ...(reference === null ? {} : { config: reference }),
    });
    experiment.runs.push({ ...spec, runId: created.runId });
  }
}

/**
 * The resolved configuration of the first run of the variant: the one the repetitions repeat.
 * Null before the variant has a run. A lost sample stops the experiment: repeating another
 * configuration would compare something else.
 */
function referenceOf(
  states: ProbeStates,
  experiment: ProbeExperiment,
  candidate: string,
): ResolvedConfig | null {
  const run = experiment.runs.find((entry) => entry.candidate === candidate);
  if (run === undefined) return null;
  const state = states.lookup(run.runId);
  if (state === undefined) {
    throw rejected(
      `the run ${run.runId} of candidate ${candidate} is gone: its configuration cannot be repeated`,
    );
  }
  return state.run.config;
}
