import { findWorkflow, groupWorkflow, type ResolvedConfig } from '../config/index.ts';

import { Rejection } from './errors.ts';

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
