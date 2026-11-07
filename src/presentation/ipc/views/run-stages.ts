import {
  type Group,
  type GroupWait,
  type RunState,
  type Topology,
  findGroup,
  topology,
} from '../../../feature/runs/types/index.ts';
import type { RunView } from '../contract/responses/runs.ts';
import { displayStatus, groupHold, isHold, serviceStatus } from './rows.ts';

export type WaitOf = (group: Group) => GroupWait | null;

/** Status of the split step and of the resolver as the view shows them. */
export function stageStatuses(state: RunState, waitOf: WaitOf) {
  return {
    split: state.split
      ? displayStatus(
          serviceStatus(state.split),
          waitOf(state.split),
          groupHold(state, state.split),
        )
      : null,
    resolve: state.resolve ? displayStatus(state.resolve.status, waitOf(state.resolve)) : null,
  };
}

/** The topology with the groups the scheduler holds back shown as `waiting`, `frozen` or `paused`. */
export function waitingTopology(
  state: RunState,
  stages: ReturnType<typeof stageStatuses>,
  waitOf: WaitOf,
): Topology {
  const result = topology(state);
  const shownOf = (found: Group) => displayStatus('queued', waitOf(found), groupHold(state, found));
  for (const step of result.steps) {
    for (const group of step.groups) {
      const found = state.groups.find((candidate) => candidate.slug === group.slug);
      if (!found || group.status !== 'queued') continue;
      const shown = shownOf(found);
      if (shown !== 'queued') group.status = shown;
    }
  }
  if (result.split && (stages.split === 'waiting' || isHold(stages.split))) {
    result.split.status = stages.split;
  }
  if (result.delivery.resolverStatus && stages.resolve === 'waiting') {
    result.delivery.resolverStatus = 'waiting';
  }
  for (const stage of result.stages) {
    const found = stage.group === null ? undefined : findGroup(state, stage.group);
    if (!found || stage.status !== 'queued') continue;
    const shown = shownOf(found);
    if (shown !== 'queued') stage.status = shown;
  }
  return result;
}

export function splitRow(
  state: RunState,
  stages: ReturnType<typeof stageStatuses>,
  waitOf: WaitOf,
): RunView['split'] {
  if (!state.split) return null;
  return {
    status: stages.split ?? 'queued',
    wait: groupHold(state, state.split) === null ? waitOf(state.split) : null,
    question: state.split.question,
    questions: state.split.questions,
    humanOnly: state.split.humanOnly,
    reason: state.split.reason,
  };
}

export function resolverRow(
  state: RunState,
  stages: ReturnType<typeof stageStatuses>,
  waitOf: WaitOf,
): RunView['resolver'] {
  if (!state.resolve) return null;
  return {
    status: stages.resolve ?? state.resolve.status,
    wait: waitOf(state.resolve),
    round: state.run.pendingDelivery?.round ?? state.resolve.attempts.length,
    rounds: state.run.config.delivery.resolverRounds,
    conflicts: [...(state.run.pendingDelivery?.conflicts ?? [])],
    reason: state.resolve.reason,
  };
}
