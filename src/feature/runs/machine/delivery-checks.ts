import { rejected } from '../../../platform/errors/index.ts';
import {
  type Group,
  type RunState,
  enterPoint,
  pointClosed,
  pointEntered,
} from '../types/index.ts';
import type { DeliveryEffect } from './events.ts';

function deliverable(group: Group): boolean {
  return group.status === 'merged' && group.delivery.state !== 'applied';
}

export function selectGroups(state: RunState, requested: string[] | null): Group[] {
  if (state.run.refStyle === 'branches') {
    throw rejected(
      `run ${state.run.id} keeps its result on branch ${state.run.branch}; merge it with \`git merge ${state.run.branch}\``,
    );
  }
  if (requested === null || requested.length === 0) {
    const groups = state.groups.filter(deliverable);
    if (groups.length === 0) throw rejected('nothing to deliver: no merged groups are waiting');
    return groups;
  }
  return requested.map((slug) => requestedGroup(state, slug, 'delivered'));
}

function requestedGroup(state: RunState, slug: string, verb: string): Group {
  const group = state.groups.find((candidate) => candidate.slug === slug);
  if (!group) throw rejected(`unknown group \`${slug}\``);
  if (group.delivery.state === 'applied') throw rejected(`group \`${slug}\` is already delivered`);
  if (group.status !== 'merged') {
    throw rejected(`group \`${slug}\` is ${group.status}; only merged groups can be ${verb}`);
  }
  return group;
}

/**
 * The user merged the result by hand: mark merged groups delivered without any git operation.
 * `null` or an empty list selects every merged group that is not delivered yet.
 */
export function markDelivered(
  state: RunState,
  requested: string[] | null,
  now: number,
): DeliveryEffect[] {
  if (state.run.pendingDelivery !== null) {
    throw rejected(`a delivery of run ${state.run.id} is already in progress`);
  }
  let groups: Group[];
  if (requested === null || requested.length === 0) {
    groups = state.groups.filter(deliverable);
    if (groups.length === 0)
      throw rejected('nothing to mark: no merged groups are waiting for delivery');
  } else {
    groups = requested.map((slug) => requestedGroup(state, slug, 'marked delivered'));
  }
  for (const group of groups) {
    group.delivery = {
      state: 'applied',
      reason: null,
      files: [],
      conflicts: [],
      userEdits: [],
      manual: true,
      finishedAt: now,
    };
  }
  return cleanupIfDelivered(state);
}

/** Every merged group is delivered and every group of the run has settled. */
function allDelivered(state: RunState): boolean {
  const merged = state.groups.filter((group) => group.status === 'merged');
  const everything =
    merged.length > 0 && merged.every((group) => group.delivery.state === 'applied');
  const settled = state.groups.every((group) =>
    ['merged', 'failed', 'cancelled'].includes(group.status),
  );
  return everything && settled;
}

/**
 * The actions after delivery have run (or were never due), so the run may be cleaned up. True
 * only when the point was entered: a run without such actions is cleaned up at once.
 */
export function afterDeliveryDone(state: RunState): boolean {
  return (
    allDelivered(state) &&
    pointEntered(state, 'after_delivery') &&
    pointClosed(state, 'after_delivery')
  );
}

/**
 * When every group is delivered: starts the actions after delivery (not after a delivery the user
 * marked by hand), and cleans the run up once they are done, unless `delivery.keep` is set.
 */
export function cleanupIfDelivered(state: RunState): DeliveryEffect[] {
  if (!allDelivered(state)) return [];
  const manual = state.groups.some((group) => group.status === 'merged' && group.delivery.manual);
  if (!manual && !pointEntered(state, 'after_delivery')) {
    if (enterPoint(state, 'after_delivery').length > 0) return [];
  }
  if (!pointClosed(state, 'after_delivery')) return [];
  return state.run.config.delivery.keep ? [] : [{ kind: 'cleanup', run: state.run.id }];
}
