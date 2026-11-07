import { randomInt } from 'node:crypto';

import { isRejected, rejected } from '../../../platform/errors/index.ts';
import { currentPermissions, type RunsServices } from '../../runs/services/index.ts';
import {
  retryableGroups,
  runCreated,
  type OnLimit,
  type RunCreated,
  type RunRequest,
  type RunState,
} from '../../runs/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';
import { knownTags } from '../../tags/types/index.ts';
import type { QueueObservePort, RepairPolicyPort } from '../ports/index.ts';
import {
  acknowledgeRun,
  advance,
  autopilotAnswers,
  claimPlace,
  itemFailed,
  itemStarted,
  queueItemId,
  queueWakeAt,
  type Queue,
  type QueueItem,
} from '../types/index.ts';

import type { QueueStore } from './store.ts';

export interface QueueAdvanceDependencies {
  store: QueueStore;
  runs: Pick<RunsServices, 'states' | 'engine' | 'requests'>;
  tags: TagCatalogService;
  config: ConfigService;
  repair: RepairPolicyPort;
  observe: QueueObservePort;
  now: () => number;
}

/** The arguments of `run` that an item of the queue stands for. */
function itemRequest(queue: Queue, item: QueueItem): RunRequest {
  return {
    repository: queue.repository,
    pipeline: item.pipeline,
    ...(item.task !== null ? { task: item.task } : {}),
    ...(item.groups !== null ? { groups: item.groups } : {}),
    ...(item.title !== null ? { title: item.title } : {}),
    ...(item.autoDeliver !== null ? { autoDeliver: item.autoDeliver } : {}),
    ...(item.deliveryMode !== null ? { deliveryMode: item.deliveryMode } : {}),
    ...(item.skip.length > 0 ? { skip: item.skip } : {}),
  };
}

/** The queue moves on: it starts items, freezes and resumes runs, answers for the autopilot. */
export class QueueAdvance {
  private readonly dependencies: QueueAdvanceDependencies;
  private readonly requested = new Set<string>();

  constructor(dependencies: QueueAdvanceDependencies) {
    this.dependencies = dependencies;
  }

  /** A run was saved: the queue of its repository looks at it when it holds or waits for it. */
  runChanged(state: RunState): void {
    const queue = this.dependencies.store.get(state.run.repository);
    if (
      queue &&
      (queue.runs.length > 0 ||
        queue.skipped.includes(state.run.id) ||
        queue.items.some((item) => item.after.includes(state.run.id)))
    ) {
      this.request(state.run.repository);
    }
  }

  /** Looks at the queue of the repository once, however many changes arrive meanwhile. */
  request(repository: string): void {
    const { engine } = this.dependencies.runs;
    if (engine.stopping || this.requested.has(repository)) return;
    this.requested.add(repository);
    void engine
      .serial(async () => {
        this.requested.delete(repository);
        if (!engine.stopping) await this.advance(repository);
      })
      .catch(() => undefined);
  }

  /** A look at the queue of the repository is pending: the autopilot answers there first. */
  pending(repository: string): boolean {
    return this.requested.has(repository);
  }

  /** What a usage limit does to the groups of the repository's runs: the queue's setting. */
  onLimitOf(repository: string): OnLimit {
    return this.dependencies.store.of(repository).onLimit;
  }

  /** Moments a queue stopped by a usage limit may start again. */
  wakeMoments(): number[] {
    return this.dependencies.store.all().flatMap((queue) => queueWakeAt(queue) ?? []);
  }

  /** Starts the queues that resume after a usage limit. */
  async wake(): Promise<void> {
    for (const queue of this.dependencies.store.all()) {
      if (queue.stop?.kind === 'limit') await this.advance(queue.repository);
    }
  }

  /** At the start: the queues that run, hold runs or wait for a usage limit move on. */
  async resume(): Promise<void> {
    for (const queue of this.dependencies.store.all()) {
      if (
        queue.status === 'running' ||
        queue.runs.length > 0 ||
        queue.skipped.length > 0 ||
        queue.stop?.kind === 'limit'
      ) {
        await this.advance(queue.repository);
      }
    }
  }

  /** Moves the queue on; returns the runs created for its items, by item id. */
  async advance(repository: string): Promise<Map<string, RunCreated>> {
    const { store, runs, repair, now } = this.dependencies;
    const queue = store.of(repository);
    const fingerprint = () => JSON.stringify({ ...queue, updatedAt: 0 });
    const before = fingerprint();
    const states = queue.runs.flatMap((id) => runs.states.lookup(id) ?? []);
    // An incident an observer takes does not stop the queue.
    for (const state of states) if (repair.takesIncident(state)) acknowledgeRun(queue, state);
    const lookup = (id: string) => runs.states.lookup(id);
    const { take, freeze } = advance(queue, states, lookup, now());
    const changedBefore = fingerprint() !== before;
    for (const id of freeze) await this.freeze(id);
    await this.answerForAutopilot(queue);
    const { started, changed, failed } = await this.takeItems(queue, take);
    if (changedBefore || changed) store.save(queue);
    else store.check(queue);
    if ((take.length > 0 && queue.runs.length > 0) || (failed && queue.status === 'running')) {
      this.request(repository);
    }
    runs.engine.armWake();
    // After the autopilot: the incidents it did not answer are the observers'.
    this.dependencies.observe.request();
    return started;
  }

  /** Sets `hold: frozen` on a run the queue has taken off its places for a priority run. */
  async freeze(id: string): Promise<void> {
    const state = this.dependencies.runs.states.lookup(id);
    if (!state) return;
    try {
      await this.dependencies.runs.engine.apply(state, { kind: 'hold', hold: 'frozen' });
    } catch (error) {
      if (!isRejected(error)) throw error;
    }
  }

  /** A priority action: the run takes a place, and the last run that took one may be frozen. */
  async claimPlace(queue: Queue, run: string): Promise<void> {
    const { runs, now } = this.dependencies;
    const moment = now();
    const states = queue.runs.flatMap((id) => runs.states.lookup(id) ?? []);
    const frozen = claimPlace(queue, states, run, queueItemId(moment, randomInt(36 ** 3)), moment);
    if (frozen !== null) await this.freeze(frozen);
  }

  /**
   * Takes a returned run: retries its failed and cancelled groups, and the run holds a place in
   * the queue instead of the item.
   */
  async takeReturned(queue: Queue, item: QueueItem): Promise<RunCreated> {
    const { runs, config, now } = this.dependencies;
    const id = item.run as string;
    const state = runs.states.lookup(id);
    if (!state) throw rejected(`unknown run \`${id}\``);
    const held = state.run.hold !== null;
    if (held) await runs.engine.apply(state, { kind: 'hold', hold: null });
    const groups = retryableGroups(state);
    if (groups.length === 0 && !held) throw rejected('run has no failed or cancelled groups');
    for (const group of groups) {
      const permissions = currentPermissions(config, state);
      await runs.engine.apply(state, { kind: 'retry', group, permissions });
    }
    acknowledgeRun(queue, state);
    itemStarted(queue, item.id, id, now());
    return runCreated(state);
  }

  /** Creates the run of an item of the queue with the item's tags still in the catalog. */
  createRun(queue: Queue, item: QueueItem): Promise<RunCreated> {
    const tags = knownTags(this.dependencies.tags.of(queue.repository), item.tags);
    return this.dependencies.runs.requests.create(itemRequest(queue, item), tags, item);
  }

  private async answerForAutopilot(queue: Queue): Promise<void> {
    const { runs, config } = this.dependencies;
    const current = queue.runs.flatMap((id) => runs.states.lookup(id) ?? []);
    for (const answer of autopilotAnswers(queue, current)) {
      const state = runs.states.lookup(answer.run);
      if (!state) continue;
      try {
        await runs.engine.apply(state, {
          kind: 'answer',
          group: answer.group,
          answer: answer.answer,
          by: 'autopilot',
          permissions: currentPermissions(config, state),
        });
      } catch (error) {
        if (!isRejected(error)) throw error;
      }
    }
  }

  private async takeItems(queue: Queue, take: QueueItem[]) {
    const { store, now } = this.dependencies;
    const started = new Map<string, RunCreated>();
    let changed = false;
    let failed = false;
    for (const item of take) {
      try {
        if (item.run !== null) {
          await this.takeReturned(queue, item);
        } else {
          const created = await this.createRun(queue, item);
          itemStarted(queue, item.id, created.runId, now());
          started.set(item.id, created);
        }
        store.write(queue);
      } catch (error) {
        itemFailed(queue, item.id, (error as Error).message, now());
        changed = true;
        if (!queue.skipFailed) break;
        failed = true;
        continue;
      }
      changed = true;
    }
    return { started, changed, failed };
  }
}
