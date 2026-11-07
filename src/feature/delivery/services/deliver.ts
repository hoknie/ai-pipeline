import { changedFiles } from '../../../platform/git/index.ts';
import type { RunEngine, RunStates } from '../../runs/services/index.ts';
import type { Group, RunState } from '../../runs/types/index.ts';
import type { ApplyResult } from '../types/index.ts';

/** The files the merged groups changed: the requested ones, or those not delivered yet. */
async function mergedFiles(state: RunState, slugs: string[] | null): Promise<string[]> {
  const groups = state.groups.filter(
    (group) =>
      group.mergeCommit !== null &&
      group.status === 'merged' &&
      (slugs === null || slugs.length === 0
        ? group.delivery.state !== 'applied'
        : slugs.includes(group.slug)),
  );
  const files = await Promise.all(
    groups.map((group) =>
      changedFiles(state.run.repository, `${group.mergeCommit}^1`, group.mergeCommit as string),
    ),
  );
  return [...new Set(files.flat())].sort();
}

/** The delivery of a group without the commit message, which only the actions after delivery need. */
function deliveryOutcome(delivery: Group['delivery']): Group['delivery'] {
  const { message: _message, ...rest } = delivery;
  return rest;
}

/** The groups the answer names: the requested ones, or those merged and delivered just now. */
function delivered(
  state: RunState,
  requested: string[] | null,
  before: ReadonlySet<string>,
): ApplyResult['groups'] {
  return state.groups
    .filter((group) =>
      requested && requested.length > 0
        ? requested.includes(group.slug)
        : group.status === 'merged' && !before.has(group.slug),
    )
    .map((group) => ({ slug: group.slug, delivery: deliveryOutcome(group.delivery) }));
}

function appliedBefore(state: RunState): Set<string> {
  return new Set(
    state.groups.filter((group) => group.delivery.state === 'applied').map((group) => group.slug),
  );
}

/** The requests of the user to deliver the result of a run or to count it as delivered. */
export class DeliverService {
  private readonly dependencies: { states: RunStates; engine: RunEngine };

  constructor(dependencies: { states: RunStates; engine: RunEngine }) {
    this.dependencies = dependencies;
  }

  /** `apply`: delivers the merged groups into the working tree. */
  deliver(params: { runId: string; groups?: string[] | undefined; force?: boolean | undefined }) {
    const { states, engine } = this.dependencies;
    return engine.serial(async (): Promise<ApplyResult> => {
      const state = states.get(params.runId);
      const requested = params.groups ?? null;
      const files = await mergedFiles(state, requested);
      const before = appliedBefore(state);
      await engine.apply(state, {
        kind: 'deliver_requested',
        groups: requested,
        force: params.force ?? false,
        files,
      });
      return {
        runId: state.run.id,
        pending: state.run.pendingDelivery !== null,
        groups: delivered(state, requested, before),
      };
    });
  }

  /** `run_mark_delivered`: the user delivered the groups by hand. */
  markDelivered(params: { runId: string; groups?: string[] | undefined }) {
    const { states, engine } = this.dependencies;
    return engine.serial(async (): Promise<ApplyResult> => {
      const state = states.get(params.runId);
      const requested = params.groups ?? null;
      const before = appliedBefore(state);
      await engine.apply(state, { kind: 'delivered_marked', groups: requested });
      return { runId: state.run.id, pending: false, groups: delivered(state, requested, before) };
    });
  }
}
