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
 * The chain item the step of a group would run on with `provider`; null when the step has no
 * `by_provider` tier, so the provider does not decide its item.
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
  const chain = run.config.chains.find((item) => item.slug === specialist.runtimeChain);
  if (!chain || !chain.enabled || chain.mode !== 'by_provider') return undefined;
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
  return selected.chainIndex ?? null;
}

function switchGroup(m: Ctx, group: Group, provider: string | null): void {
  const { run } = m.state;
  const running = group.attempts.find((attempt) => attempt.status === 'running');
  if (running) {
    // a reset to `none` leaves a running attempt on the item it is on
    if (provider === null) return;
    const item = itemWith(run, group, running.stepIndex, provider);
    if (item === undefined || item === (running.chainIndex ?? null)) return;
    restartStep(m, group, running, { kind: 'provider', from: run.provider, to: provider });
    return;
  }
  if (!group.pending) return;
  const stepIndex = group.pending.stepIndex;
  const item = itemWith(run, group, stepIndex, provider);
  if (item === undefined) return;
  const previous = group.attempts.findLast((attempt) => attempt.stepIndex === stepIndex);
  if (previous && item !== (previous.chainIndex ?? null)) dropResume(group);
}

/**
 * The run goes on with another provider (null: none). A running step whose tier item changes starts
 * again without a commit; a waiting group takes the new item in a new session. The steps the
 * provider does not touch go on.
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
  for (const group of groups) switchGroup(m, group, provider);
  run.provider = provider;
}
