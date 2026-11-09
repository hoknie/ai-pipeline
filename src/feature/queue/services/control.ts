import { randomInt } from 'node:crypto';

import { rejected } from '../../../platform/errors/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import {
  currentPermissions,
  currentSpecialists,
  type RunsServices,
} from '../../runs/services/index.ts';
import {
  retryableGroups,
  type OnLimit,
  type RunCreated,
  type RunState,
} from '../../runs/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import {
  adoptRun,
  dismissRun,
  itemStarted,
  pauseQueue,
  pauseRun,
  problemKeys,
  queueItemId,
  returnRun,
  setParallel,
  setQueueSettings,
  startQueue,
  type Queue,
  type QueueChange,
  type QueueSettingsRequest,
} from '../types/index.ts';

import type { QueueAdvance } from './advance.ts';
import type { QueueStore } from './store.ts';

export interface QueueControlDependencies {
  store: QueueStore;
  advance: QueueAdvance;
  registry: RegistryService;
  config: ConfigService;
  runs: Pick<RunsServices, 'states' | 'engine'>;
  now: () => number;
}

/** A run of the request, checked to belong to the repository the client names. */
type RunRef = { runId: string; repository?: string | undefined };

/** Starting, pausing and setting up a queue; returning, pausing and retrying its runs. */
export class QueueControl {
  private readonly dependencies: QueueControlDependencies;

  constructor(dependencies: QueueControlDependencies) {
    this.dependencies = dependencies;
  }

  /** The queue of the repository that holds `path`. */
  async queueOf(path: string): Promise<Queue> {
    return this.dependencies.store.of(await this.dependencies.registry.rootOf(path));
  }

  async start(params: { repository: string; parallel?: number | undefined }): Promise<Queue> {
    const { store, advance, registry, now } = this.dependencies;
    const queue = await this.queueOf(params.repository);
    registry.requireEnabled(queue.repository);
    if (params.parallel !== undefined) setParallel(queue, params.parallel, now());
    startQueue(queue, this.statesOf(queue), now());
    store.save(queue);
    await advance.advance(queue.repository);
    return queue;
  }

  async pause(params: { repository: string }): Promise<Queue> {
    const queue = await this.queueOf(params.repository);
    pauseQueue(queue, this.dependencies.now());
    return this.dependencies.store.save(queue);
  }

  async settings(params: QueueSettingsRequest): Promise<Queue> {
    const { store, advance, now } = this.dependencies;
    const queue = await this.queueOf(params.repository);
    const { parallel, autopilot, autoAnswer, skipFailed, autopilotAnswer } = params;
    const onLimit = params.onLimit as OnLimit | undefined;
    const enablesAutopilot = autopilot === true && !queue.autopilot;
    setQueueSettings(
      queue,
      { parallel, autopilot, autoAnswer, skipFailed, autopilotAnswer, onLimit },
      now(),
    );
    const enabled = this.dependencies.registry.entry(queue.repository)?.enabled !== false;
    if (enablesAutopilot && enabled && queue.status === 'stopped' && queue.stop === null) {
      startQueue(queue, this.statesOf(queue), now());
    }
    store.save(queue);
    await advance.advance(queue.repository);
    return queue;
  }

  /** `queue_run_now`: the item starts at once, taking a place a lower run may give up. */
  async runNow(params: { repository: string; item: string }): Promise<RunCreated> {
    const { store, advance, runs, registry, now } = this.dependencies;
    const queue = await this.queueOf(params.repository);
    registry.requireEnabled(queue.repository);
    const item = queue.items.find((candidate) => candidate.id === params.item);
    if (!item) throw rejected('unknown queue item');
    if (item.run !== null) {
      const target = runs.states.lookup(item.run);
      if (!target) throw rejected(`unknown run \`${item.run}\``);
      if (target.run.hold === null && retryableGroups(target).length === 0) {
        throw rejected('run has no failed or cancelled groups');
      }
      await advance.claimPlace(queue, item.run);
      const resumed = await advance.takeReturned(queue, item);
      store.save(queue);
      return resumed;
    }
    const created = await advance.createRun(queue, item);
    await advance.claimPlace(queue, created.runId);
    itemStarted(queue, item.id, created.runId, now());
    store.save(queue);
    return created;
  }

  /** `queue_return`: the run goes back to the queue as its first item. */
  returnRun(params: RunRef): Promise<QueueChange> {
    return this.withQueue(params, (queue, state, id, moment) => {
      this.dependencies.registry.requireEnabled(queue.repository);
      return returnRun(queue, state, id, moment);
    });
  }

  /**
   * `run_pause`: the run keeps `hold: paused` and becomes the last item of the queue; the running
   * agents are stopped by the `hold` event, and after run-now the step continues in the same session.
   */
  pauseRun(params: RunRef): Promise<QueueChange> {
    return this.withQueue(params, async (queue, state, id, moment) => {
      const item = pauseRun(queue, state, id, moment);
      await this.dependencies.runs.engine.apply(state, { kind: 'hold', hold: 'paused' });
      return item;
    });
  }

  /** `queue_dismiss`: a skipped run leaves the skipped list. */
  async dismiss(params: RunRef): Promise<Queue> {
    const { queue } = await this.withQueue(params, (queue, state, _id, moment) => {
      dismissRun(queue, state, moment);
      return { id: '' };
    });
    return queue;
  }

  /** `retry`: a direct retry works at once, and the revived run holds a place in the queue. */
  retry(params: { runId: string; group: string; refreshConfig?: boolean | undefined }) {
    const { runs } = this.dependencies;
    return runs.engine.serial(() => this.retryNow(runs.states.get(params.runId), params));
  }

  /** The retry itself, for callers that already run inside `serial`. */
  async retryNow(
    state: RunState,
    params: { group: string; refreshConfig?: boolean | undefined },
  ): Promise<RunState> {
    const { store, advance, config, runs, registry, now } = this.dependencies;
    registry.requireEnabled(state.run.repository);
    const keys = problemKeys(state);
    // Loaded before the event: a broken configuration refuses the retry with nothing changed.
    const refresh =
      params.refreshConfig === true
        ? { specialists: currentSpecialists(config, state) }
        : { permissions: currentPermissions(config, state) };
    // A rejected retry leaves the hold in place; the hold is released only after it succeeds.
    await runs.engine.apply(state, { kind: 'retry', group: params.group, ...refresh });
    if (state.run.hold !== null) await runs.engine.apply(state, { kind: 'hold', hold: null });
    const queue = store.of(state.run.repository);
    const moment = now();
    const adopted = adoptRun(queue, state, keys, moment, {
      states: this.statesOf(queue),
      itemId: queueItemId(moment, randomInt(36 ** 3)),
    });
    if (adopted) {
      if (adopted.frozen !== null) await advance.freeze(adopted.frozen);
      store.save(queue);
      advance.request(state.run.repository);
    }
    return state;
  }

  private statesOf(queue: Queue): RunState[] {
    return queue.runs.flatMap((id) => this.dependencies.runs.states.lookup(id) ?? []);
  }

  /** A change of a run in its queue: checked, saved, then the queue advances. */
  private withQueue(
    params: RunRef,
    change: (
      queue: Queue,
      state: RunState,
      id: string,
      moment: number,
    ) => { id: string } | Promise<{ id: string }>,
  ): Promise<QueueChange> {
    const { store, advance, registry, runs, now } = this.dependencies;
    return runs.engine.serial(async () => {
      const state = runs.states.get(params.runId);
      if (params.repository !== undefined) {
        const root = await registry.rootOf(params.repository);
        if (root !== state.run.repository) throw rejected('run belongs to another repository');
      }
      const queue = store.of(state.run.repository);
      const moment = now();
      const item = await change(queue, state, queueItemId(moment, randomInt(36 ** 3)), moment);
      store.save(queue);
      await advance.advance(state.run.repository);
      return { queue, item: item.id };
    });
  }
}
