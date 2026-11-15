import type { RunsServices } from '../../runs/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { QueueScopeName } from '../../swarm-config/types/index.ts';
import {
  fillGlobalPositions,
  pauseQueue,
  restoreProjectOrder,
  type GlobalQueue,
  type Queue,
} from '../types/index.ts';

import type { QueueStore } from './store.ts';

export interface QueueScopeDependencies {
  store: QueueStore;
  config: ConfigService;
  runs: Pick<RunsServices, 'states' | 'engine'>;
  now: () => number;
}

/** What the settings ask for: the mode of `queue.scope`, and `project` while the section is wrong. */
export function wantedScope(config: ConfigService): QueueScopeName {
  const settings = config.queueSettings();
  return typeof settings === 'string' ? 'project' : settings.scope;
}

/**
 * The mode of the queue: the daemon remembers the mode its queues are arranged for and compares it
 * with `queue.scope` of the shared settings. A change pauses every queue, moves the runs that
 * occupy places to the queues of the new mode and puts the waiting tasks in their order.
 */
export class QueueScope {
  private readonly dependencies: QueueScopeDependencies;

  constructor(dependencies: QueueScopeDependencies) {
    this.dependencies = dependencies;
  }

  /** The mode the daemon works in now. */
  current(): QueueScopeName {
    return this.dependencies.store.scope();
  }

  /** Looks at the settings after a change of the shared settings.yaml. */
  request(): void {
    const { runs, config, store } = this.dependencies;
    if (wantedScope(config) === store.scope()) return;
    void runs.engine
      .serial(async () => {
        this.sync();
      })
      .catch(() => undefined);
  }

  /** Arranges the queues for the mode of the settings; true when the mode changed. */
  sync(): boolean {
    const { store, config, now } = this.dependencies;
    const target = wantedScope(config);
    const global = store.globalQueue();
    if (target === global.appliedScope) return false;
    const moment = now();
    const queues = store.all();
    // Every queue goes on pause; the runs that work are not touched.
    for (const queue of queues) pauseQueue(queue, moment);
    global.status = 'stopped';
    if (global.stop?.kind === 'limit') global.stop = { ...global.stop, autoResume: false };
    if (target === 'global') this.enableGlobal(global, queues);
    else this.disableGlobal(global, queues);
    global.appliedScope = target;
    global.updatedAt = moment;
    store.saveEverything();
    return true;
  }

  /** Waiting tasks get the order of the time they were added; the places of the runs join. */
  private enableGlobal(global: GlobalQueue, queues: Queue[]): void {
    fillGlobalPositions(queues);
    for (const queue of queues) {
      global.runs.push(...queue.runs.filter((id) => !global.runs.includes(id)));
      global.priority.push(...queue.priority.filter((id) => !global.priority.includes(id)));
      global.skipped.push(...queue.skipped.filter((id) => !global.skipped.includes(id)));
      global.acknowledged.push(...queue.acknowledged);
      queue.runs = [];
      queue.priority = [];
      queue.skipped = [];
      queue.acknowledged = [];
    }
    global.acknowledged = [...new Set(global.acknowledged)];
  }

  /** Every project queue gets its tasks in their global order and the runs that held its places. */
  private disableGlobal(global: GlobalQueue, queues: Queue[]): void {
    const { store, runs } = this.dependencies;
    restoreProjectOrder(queues);
    const owner = (id: string): Queue | undefined => {
      const repository = runs.states.lookup(id)?.run.repository;
      return repository === undefined ? undefined : store.of(repository);
    };
    for (const id of global.runs) {
      const queue = owner(id);
      if (!queue) continue;
      queue.runs.push(id);
      queue.acknowledged.push(...global.acknowledged.filter((key) => key.startsWith(`${id}/`)));
    }
    for (const id of global.priority) owner(id)?.priority.push(id);
    for (const id of global.skipped) owner(id)?.skipped.push(id);
    global.runs = [];
    global.priority = [];
    global.skipped = [];
    global.acknowledged = [];
    global.stop = null;
  }
}
