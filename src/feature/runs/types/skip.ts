import { rejected } from '../../../platform/errors/index.ts';
import {
  type ResolvedConfig,
  findPipeline,
  groupPipeline,
  skipProblem,
} from '../../swarm-config/types/index.ts';
import { type Group, stepsOf } from './group.ts';
import { type Run, type RunState, runPipeline } from './run.ts';
import { stepLabel } from './topology.ts';

/** Collapses repeats, keeping the order. */
export function cleanSkip(skip: readonly string[]): string[] {
  return [...new Set(skip)];
}

/** The error text of a `skip` that does not fit the pipeline, or `null`. */
export function checkSkip(
  config: ResolvedConfig,
  pipelineId: string,
  skip: readonly string[],
): string | null {
  const wanted = cleanSkip(skip);
  if (wanted.length === 0) return null;
  const pipeline = findPipeline(config, pipelineId);
  if (!pipeline) return `unknown pipeline \`${pipelineId}\``;
  const steps = groupPipeline(config, pipeline).steps;
  return skipProblem(steps, wanted);
}

/** A copy of the configuration without the skipped steps in the pipeline the groups follow. */
export function applySkip(
  config: ResolvedConfig,
  pipelineId: string,
  skip: readonly string[],
): ResolvedConfig {
  const wanted = cleanSkip(skip);
  if (wanted.length === 0) return config;
  const error = checkSkip(config, pipelineId, wanted);
  if (error !== null) throw rejected(error);
  const pipeline = findPipeline(config, pipelineId);
  if (!pipeline) throw rejected(`unknown pipeline \`${pipelineId}\``);
  const target = groupPipeline(config, pipeline);
  return {
    ...config,
    pipelines: config.pipelines.map((candidate) =>
      candidate.id === target.id
        ? { ...candidate, steps: candidate.steps.filter((step) => !wanted.includes(step.id)) }
        : candidate,
    ),
  };
}

/** Whether the run skips the step (a step skipped after the start). */
export function isSkipped(run: Run, stepId: string): boolean {
  return run.skippedSteps.includes(stepId);
}

/** The first step at or after `from` that the run does not skip, or `null`. */
export function nextUnskipped(run: Run, group: Group, from: number): number | null {
  const steps = stepsOf(run, group);
  for (let index = Math.max(from, 0); index < steps.length; index += 1) {
    const step = steps[index];
    if (step && !isSkipped(run, step.id)) return index;
  }
  return null;
}

/** The last step the run does not skip. */
export function lastUnskipped(run: Run, group: Group): number {
  const steps = stepsOf(run, group);
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step && !isSkipped(run, step.id)) return index;
  }
  return steps.length - 1;
}

export type StepPhase = 'done' | 'active' | 'upcoming';

export interface StepState {
  id: string;
  specialist: string;
  name: string;
  skipped: boolean;
  state: StepPhase;
}

/** Where a work group stands: the index of its step, or the step count after the last one. */
function position(state: RunState, group: Group, count: number): number {
  if (group.status === 'merging' || group.status === 'merged' || group.status === 'conflict') {
    return count;
  }
  const running = group.attempts.find((attempt) => attempt.status === 'running');
  if (running) return running.stepIndex;
  if (group.pending) return group.pending.stepIndex;
  return group.attempts.at(-1)?.stepIndex ?? 0;
}

/** Each step of the group pipeline: passed by every group, under way, or still ahead. */
export function stepStates(state: RunState): StepState[] {
  const steps = groupPipeline(state.run.config, runPipeline(state.run)).steps;
  const positions = state.groups.map((group) => position(state, group, steps.length));
  return steps.map((step, index): StepState => {
    let progress: StepPhase = 'done';
    if (positions.length === 0 || positions.some((at) => at < index)) progress = 'upcoming';
    if (positions.some((at) => at === index)) progress = 'active';
    return {
      id: step.id,
      specialist: step.specialist,
      name: stepLabel(state.run.config, steps, step),
      skipped: isSkipped(state.run, step.id),
      state: progress,
    };
  });
}
