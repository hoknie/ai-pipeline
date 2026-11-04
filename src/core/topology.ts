import {
  findSpecialist,
  findWorkflow,
  groupWorkflow,
  type OnReject,
  type Permissions,
  type ResolvedConfig,
  type Runtime,
  type Step,
  type Workflow,
} from '../config/index.ts';

import {
  addUsage,
  runWorkflow,
  stepsOf,
  type Attempt,
  type Group,
  type GroupStatus,
  type RunState,
  type Usage,
} from './model.ts';

export interface StepGroup {
  slug: string;
  title: string;
  status: GroupStatus | 'waiting';
}

export interface StepInfo {
  id: string;
  specialist: string;
  name: string;
  runtime: Runtime;
  model: string | null;
  permissions: Permissions;
  onReject: OnReject | null;
}

export interface StepTopology extends StepInfo {
  /** Groups whose current or next attempt is this step. */
  groups: StepGroup[];
  attempts: number;
  rejections: number;
  usage: Usage | null;
  /** The run skips this step. */
  skipped: boolean;
}

export interface Topology {
  split: {
    specialist: string;
    maxGroups: number;
    workflow: string | null;
    status: GroupStatus | 'waiting' | null;
  } | null;
  steps: StepTopology[];
  /** Groups waiting for or in the merge queue, or in conflict. */
  merging: StepGroup[];
  /** Merged groups. */
  merged: StepGroup[];
  delivery: {
    mode: string;
    resolver: string | null;
    resolverStatus: GroupStatus | 'waiting' | null;
  };
}

const AT_MERGE: GroupStatus[] = ['merging', 'conflict'];

function stepOf(group: Group, steps: string[]): string | null {
  if (group.status === 'merged' || group.status === 'cancelled') return null;
  if (AT_MERGE.includes(group.status)) return null;
  const running = group.attempts.find((attempt) => attempt.status === 'running');
  if (running) return running.stepId;
  if (group.pending) return steps[group.pending.stepIndex] ?? null;
  return group.attempts.at(-1)?.stepId ?? null;
}

function brief(group: Group): StepGroup {
  return { slug: group.slug, title: group.title, status: group.status };
}

export interface WorkflowTopology {
  id: string;
  split: { specialist: string; maxGroups: number; workflow: string | null } | null;
  steps: StepInfo[];
  delivery: { mode: string; resolver: string | null };
  /** `max` of the specialists of the split, the steps and the resolver, by slug. */
  limits: Record<string, number | null>;
}

/** The human name of a step: the name of its specialist, or the specialist slug without one. */
export function stepName(config: ResolvedConfig, step: Step): string {
  return specialistName(config, step.specialist);
}

/** The human name of a specialist: its name, or the slug without one. */
export function specialistName(config: ResolvedConfig, slug: string): string {
  const name = findSpecialist(config, slug)?.name.trim();
  return name ? name : slug;
}

/** The name of a step among the steps of its workflow: the id is added when another step has the same name. */
export function stepLabel(config: ResolvedConfig, steps: readonly Step[], step: Step): string {
  const name = stepName(config, step);
  const same = steps.some((other) => other.id !== step.id && stepName(config, other) === name);
  return same ? `${name} (${step.id})` : name;
}

/** The name of the step of an attempt: by the workflow of the group, else by the specialist of the attempt. */
export function attemptStepLabel(state: RunState, group: Group, attempt: Attempt): string {
  const { config } = state.run;
  try {
    const steps = stepsOf(state.run, group);
    const step = steps.find((candidate) => candidate.id === attempt.stepId);
    if (step) return stepLabel(config, steps, step);
  } catch {
    // a split group of a workflow without a split: fall back to the specialist
  }
  if (findSpecialist(config, attempt.specialist)) return specialistName(config, attempt.specialist);
  return attempt.stepId;
}

function stepInfo(config: ResolvedConfig, steps: readonly Step[], step: Step): StepInfo {
  const specialist = findSpecialist(config, step.specialist);
  return {
    id: step.id,
    specialist: step.specialist,
    name: stepLabel(config, steps, step),
    runtime: specialist?.runtime ?? config.defaults.runtime,
    model: specialist?.model ?? null,
    permissions: specialist?.permissions ?? config.defaults.permissions,
    onReject: step.onReject,
  };
}

function limitsOf(
  config: ResolvedConfig,
  workflow: Workflow,
  steps: Step[],
): Record<string, number | null> {
  const slugs = [
    ...(workflow.split ? [workflow.split.specialist] : []),
    ...steps.map((step) => step.specialist),
    ...(config.delivery.resolver ? [config.delivery.resolver] : []),
  ];
  const limits: Record<string, number | null> = {};
  for (const slug of slugs) limits[slug] = findSpecialist(config, slug)?.max ?? null;
  return limits;
}

function shape(config: ResolvedConfig, workflow: Workflow): WorkflowTopology {
  const steps = groupWorkflow(config, workflow).steps;
  return {
    id: workflow.id,
    split: workflow.split
      ? {
          specialist: workflow.split.specialist,
          maxGroups: workflow.split.maxGroups,
          workflow: workflow.split.workflow ?? null,
        }
      : null,
    steps: steps.map((step) => stepInfo(config, steps, step)),
    delivery: { mode: config.delivery.mode, resolver: config.delivery.resolver },
    limits: limitsOf(config, workflow, steps),
  };
}

/** Every workflow of a configuration, without any run. */
export function workflowTopologies(config: ResolvedConfig): WorkflowTopology[] {
  return config.workflows.map((workflow) => shape(config, workflow));
}

export function workflowTopology(config: ResolvedConfig, id: string): WorkflowTopology | null {
  const workflow = findWorkflow(config, id);
  return workflow ? shape(config, workflow) : null;
}

/** Steps of the workflow of a run with where each group is and what each step has cost. */
export function topology(state: RunState): Topology {
  const { config } = state.run;
  const workflow = runWorkflow(state.run);
  const target = groupWorkflow(config, workflow);
  const ids = target.steps.map((step) => step.id);
  const steps = target.steps.map((step): StepTopology => {
    let attempts = 0;
    let rejections = 0;
    let usage: Usage | null = null;
    for (const group of state.groups) {
      for (const attempt of group.attempts) {
        if (attempt.stepId !== step.id) continue;
        attempts += 1;
        if (attempt.report?.verdict === 'rejected') rejections += 1;
        usage = addUsage(usage, attempt.usage);
      }
    }
    return {
      ...stepInfo(config, target.steps, step),
      groups: state.groups.filter((group) => stepOf(group, ids) === step.id).map(brief),
      attempts,
      rejections,
      usage,
      skipped: state.run.skippedSteps.includes(step.id),
    };
  });
  return {
    split: workflow.split
      ? {
          specialist: workflow.split.specialist,
          maxGroups: workflow.split.maxGroups,
          workflow: workflow.split.workflow ?? null,
          status: state.split?.status ?? null,
        }
      : null,
    steps,
    merging: state.groups.filter((group) => AT_MERGE.includes(group.status)).map(brief),
    merged: state.groups.filter((group) => group.status === 'merged').map(brief),
    delivery: {
      mode: config.delivery.mode,
      resolver: config.delivery.resolver,
      resolverStatus: state.resolve?.status ?? null,
    },
  };
}
