import { rejected } from '../../../../platform/errors/index.ts';
import {
  type Pipeline,
  type ResolvedConfig,
  type Split,
  type Step,
  type StepAgent,
  findPipeline,
  groupPipeline,
} from '../../../swarm-config/types/index.ts';
import { allGroups, type Attempt, type Group, type Run } from '../../types/index.ts';
import type { Ctx } from '../events.ts';

/** What a variant sets in a step or in the split. */
interface Definition {
  specialist: string;
  additionalPrompt?: string | null;
  agent?: StepAgent;
}

function key(definition: Definition): string {
  const agent = definition.agent;
  return JSON.stringify([
    definition.specialist,
    definition.additionalPrompt ?? null,
    agent
      ? [agent.runtime, agent.model, agent.variant, agent.reasoningEffort, agent.runtimeChain]
      : null,
  ]);
}

function carry(target: Step | Split, from: Definition): void {
  target.specialist = from.specialist;
  target.additionalPrompt = from.additionalPrompt ?? null;
  if (from.agent) target.agent = { ...from.agent };
  else delete target.agent;
}

interface Plan {
  steps: { target: Step; from: Step; changed: boolean }[];
  split: { target: Split; from: Split; changed: boolean } | null;
}

function changedSince(run: Run, pipeline: string, detail: string): Error {
  return rejected(`pipeline \`${pipeline}\` changed since the run started: ${detail}`);
}

/** Matches the steps of the snapshot with the ones of the new configuration by id; changes nothing. */
function planVariant(run: Run, config: ResolvedConfig): Plan {
  const own = findPipeline(run.config, run.pipeline);
  const fresh = findPipeline(config, run.pipeline);
  if (!own || !fresh) throw changedSince(run, run.pipeline, 'the pipeline is gone');
  if (own.split && !fresh.split) throw changedSince(run, run.pipeline, 'the split is gone');
  let target: Pipeline;
  let freshTarget: Pipeline;
  try {
    target = groupPipeline(run.config, own);
    freshTarget = groupPipeline(config, fresh);
  } catch (error) {
    throw changedSince(run, run.pipeline, (error as Error).message);
  }
  const steps = target.steps.map((step) => {
    const from = freshTarget.steps.find((candidate) => candidate.id === step.id);
    if (!from) throw changedSince(run, run.pipeline, `step \`${step.id}\` is gone`);
    return { target: step, from, changed: key(step) !== key(from) };
  });
  let split: Plan['split'] = null;
  if (own.split && fresh.split) {
    split = {
      target: own.split,
      from: fresh.split,
      changed: key(own.split) !== key(fresh.split),
    };
  }
  return { steps, split };
}

/** Specialists and chains the new definitions refer to that the snapshot does not have yet. */
function addMissing(run: Run, config: ResolvedConfig, definitions: Definition[]): void {
  for (const definition of definitions) {
    if (!run.config.specialists.some((item) => item.slug === definition.specialist)) {
      const found = config.specialists.find((item) => item.slug === definition.specialist);
      if (found) run.config.specialists.push(found);
    }
    const chain = definition.agent?.runtimeChain;
    if (chain !== undefined && !run.config.chains.some((item) => item.slug === chain)) {
      const found = config.chains.find((item) => item.slug === chain);
      if (found) run.config.chains.push(found);
    }
  }
}

function restart(m: Ctx, group: Group, running: Attempt, from: string, to: string): void {
  running.status = 'cancelled';
  running.reason = { kind: 'variant', from, to };
  running.finishedAt = m.now;
  m.effects.push({
    kind: 'stop_attempt',
    run: m.state.run.id,
    group: group.slug,
    seq: running.seq,
  });
  group.status = 'queued';
  group.pending = {
    stepIndex: running.stepIndex,
    feedback: running.input.feedback,
    humanAnswer: running.input.humanAnswer,
    resume: false,
    ...(running.input.reviewed ? { reviewed: true } : {}),
  };
}

/** The executor of a step may have changed: no session of the old one is resumed. */
function restartGroup(m: Ctx, group: Group, changed: boolean[], from: string, to: string): void {
  const running = group.attempts.find((attempt) => attempt.status === 'running');
  if (running && changed[running.stepIndex]) {
    restart(m, group, running, from, to);
  } else if (!running && group.pending && changed[group.pending.stepIndex]) {
    const { keepRuntime: _keep, ...pending } = group.pending;
    group.pending = { ...pending, resume: false };
  }
}

/**
 * The run follows another variant of its pipeline. The steps, the skips and the passed steps stay;
 * a step whose specialist, executor or prompt changed starts again without the old session.
 */
export function setVariant(m: Ctx, variant: string, config: ResolvedConfig): void {
  const { run } = m.state;
  // a run with a failed or cancelled group can still be retried: it may change its variant first
  const retryable = allGroups(m.state).some(
    (group) => group.status === 'failed' || group.status === 'cancelled',
  );
  if (run.finishedAt !== null && !retryable) throw rejected(`run ${run.id} is finished`);
  if (variant === run.variant) return;
  const plan = planVariant(run, config);
  const from = run.variant;
  addMissing(run, config, [
    ...plan.steps.map((item) => item.from),
    ...(plan.split ? [plan.split.from] : []),
  ]);
  for (const item of plan.steps) carry(item.target, item.from);
  if (plan.split) carry(plan.split.target, plan.split.from);
  run.variant = variant;
  const stepsChanged = plan.steps.map((item) => item.changed);
  if (m.state.split && plan.split) {
    restartGroup(m, m.state.split, [plan.split.changed], from, variant);
  }
  for (const group of m.state.groups) restartGroup(m, group, stepsChanged, from, variant);
}
