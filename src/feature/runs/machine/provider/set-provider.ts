import { rejected } from '../../../../platform/errors/index.ts';
import {
  allGroups,
  selectAttemptRuntime,
  specialistOfStep,
  stepsOf,
  type Group,
  type Run,
} from '../../types/index.ts';
import type { Ctx } from '../events.ts';
import { dropResume, restartStep } from '../restart/index.ts';

/**
 * The chain item the step of a group would run on with `provider`; undefined when the step's
 * specialist has no `runtimeChain`, so the provider does not decide its item; null when no enabled
 * item of the provider can be selected.
 */
function itemWith(
  run: Run,
  group: Group,
  stepIndex: number,
  provider: string | null,
): number | null | undefined {
  const step = stepsOf(run, group)[stepIndex];
  const specialist = step ? specialistOfStep(run, group, step) : undefined;
  if (!specialist?.runtimeChain) return undefined;
  const selected = selectAttemptRuntime({
    specialist,
    chains: run.config.chains,
    defaults: run.config.defaults,
    limitHolds: new Map(),
    attempts: group.attempts,
    stepIndex,
    round: 0,
    resume: false,
    provider,
  });
  return selected?.chainIndex ?? null;
}

/** The step the group is on: the step of its running attempt, else of its pending one. */
function currentStep(group: Group): number | null {
  const running = group.attempts.find((attempt) => attempt.status === 'running');
  return running?.stepIndex ?? group.pending?.stepIndex ?? null;
}

/**
 * The chain of the step the group is on when switching to `provider` is impossible, else null. Only
 * an enabled chain with enabled items constrains the switch: a missing, disabled or empty chain keeps
 * `defaults.runtime` and does not depend on the provider.
 */
function missingChain(run: Run, group: Group, provider: string): string | null {
  const stepIndex = currentStep(group);
  if (stepIndex === null) return null;
  const step = stepsOf(run, group)[stepIndex];
  const specialist = step ? specialistOfStep(run, group, step) : undefined;
  if (!specialist?.runtimeChain) return null;
  const chain = run.config.chains.find((item) => item.slug === specialist.runtimeChain);
  if (!chain || !chain.enabled || !chain.runtimes.some((item) => item.enabled)) return null;
  return itemWith(run, group, stepIndex, provider) === null ? chain.slug : null;
}

function switchGroup(m: Ctx, group: Group, provider: string | null): void {
  const { run } = m.state;
  const running = group.attempts.find((attempt) => attempt.status === 'running');
  if (running) {
    // a reset to `none` leaves a running attempt on the item it is on
    if (provider === null) return;
    const item = itemWith(run, group, running.stepIndex, provider);
    if (item === undefined) return;
    // null means no item was selected: it is never the same item as the running one
    if (item !== null && item === (running.chainIndex ?? null)) return;
    restartStep(m, group, running, { kind: 'provider', from: run.provider, to: provider });
    return;
  }
  if (!group.pending) return;
  const stepIndex = group.pending.stepIndex;
  const item = itemWith(run, group, stepIndex, provider);
  if (item === undefined) return;
  const previous = group.attempts.findLast((attempt) => attempt.stepIndex === stepIndex);
  if (previous && (item === null || item !== (previous.chainIndex ?? null))) dropResume(group);
}

/**
 * The run goes on with another provider (null: none). A running step whose chain item changes starts
 * again without a commit; a waiting group takes the new item in a new session. The steps the provider
 * does not touch go on. A switch to a provider with no enabled item in the chain of a step is refused
 * before anything changes.
 */
export function setProvider(m: Ctx, provider: string | null): void {
  const { run } = m.state;
  const retryable = allGroups(m.state).some(
    (group) => group.status === 'failed' || group.status === 'cancelled',
  );
  if (run.finishedAt !== null && !retryable) throw rejected(`run ${run.id} is finished`);
  if (provider === run.provider) return;
  // the split and the work groups only: actions, the commit message, the merge resolution and the
  // observer do not depend on the provider
  const groups = m.state.split ? [m.state.split, ...m.state.groups] : m.state.groups;
  if (provider !== null) {
    for (const group of groups) {
      const chain = missingChain(run, group, provider);
      if (chain !== null) {
        throw rejected(
          `cannot switch run ${run.id} to provider \`${provider}\`: chain \`${chain}\` has no enabled item of provider \`${provider}\``,
        );
      }
    }
  }
  for (const group of groups) switchGroup(m, group, provider);
  run.provider = provider;
}
