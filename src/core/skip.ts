import { findWorkflow, groupWorkflow, type ResolvedConfig } from '../config/index.ts';

import { Rejection } from './errors.ts';
import { runWorkflow, stepsOf, type Group, type Run, type RunState } from './model.ts';
import { stepLabel } from './topology.ts';

/** Collapses repeats, keeping the order. */
export function cleanSkip(skip: readonly string[]): string[] {
  return [...new Set(skip)];
}

/** The error text of a `skip` that does not fit the workflow, or `null`. */
export function checkSkip(
  config: ResolvedConfig,
  workflowId: string,
  skip: readonly string[],
): string | null {
  const wanted = cleanSkip(skip);
  if (wanted.length === 0) return null;
  const workflow = findWorkflow(config, workflowId);
  if (!workflow) return `unknown workflow \`${workflowId}\``;
  const steps = groupWorkflow(config, workflow).steps;
  const ids = steps.map((step) => step.id);
  for (const id of wanted) {
    if (!ids.includes(id)) {
      return `unknown step \`${id}\` in skip; steps: ${ids.join(', ')}`;
    }
  }
  const left = steps.filter((step) => !wanted.includes(step.id));
  if (left.length === 0) return 'skip leaves no steps';
  for (const step of left) {
    const goto = step.onReject?.goto;
    if (goto !== undefined && wanted.includes(goto)) {
      return `step \`${step.id}\` returns to skipped step \`${goto}\``;
    }
  }
  return null;
}

/** A copy of the configuration without the skipped steps in the workflow the groups follow. */
export function applySkip(
  config: ResolvedConfig,
  workflowId: string,
  skip: readonly string[],
): ResolvedConfig {
  const wanted = cleanSkip(skip);
  if (wanted.length === 0) return config;
  const error = checkSkip(config, workflowId, wanted);
  if (error !== null) throw new Rejection(error);
  const workflow = findWorkflow(config, workflowId);
  if (!workflow) throw new Rejection(`unknown workflow \`${workflowId}\``);
  const target = groupWorkflow(config, workflow);
  return {
    ...config,
    workflows: config.workflows.map((candidate) =>
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

/** Each step of the group workflow: passed by every group, under way, or still ahead. */
export function stepStates(state: RunState): StepState[] {
  const steps = groupWorkflow(state.run.config, runWorkflow(state.run)).steps;
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
