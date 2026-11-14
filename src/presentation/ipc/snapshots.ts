import type { Group, RunState } from '../../feature/runs/types/index.ts';
import type { Queue } from '../../feature/queue/types/index.ts';
import { returnItemOf, canReturn } from '../../feature/queue/types/index.ts';
import { retryableGroups } from '../../feature/runs/types/index.ts';
import type {
  GroupView,
  ObserversView,
  QueueView,
  RepositoryView,
  RunView,
} from './contract/index.ts';
import type { DaemonServices } from './services.ts';
import {
  groupView,
  observersView,
  queueView,
  repositoryViews,
  runView,
  withQueue,
} from './views/index.ts';

/** The form of the answers and events: reads of several features turned into views. */
export class Snapshots {
  private readonly services: DaemonServices;

  constructor(services: DaemonServices) {
    this.services = services;
  }

  /** The view of a run; missing diff statistics are computed in the background. */
  run(state: RunState, now = this.services.now()): RunView {
    const { delivery, tags, runs, artifacts, observers, queue } = this.services;
    delivery.diffs.ensure(state);
    const view = runView(
      state,
      now,
      (slug) => delivery.diffs.diffOf(state.run.id, slug),
      tags.of(state.run.repository),
      runs.engine.waitOf,
      artifacts.counts(state.run.id),
      observers.policy(),
    );
    const own = queue.store.get(state.run.repository);
    const item = own ? returnItemOf(own, state.run.id) : null;
    return withQueue({ ...view, returnable: this.returnable(state) }, item?.id ?? null);
  }

  /** The recent runs, the latest first. */
  recentRuns(now = this.services.now()): RunView[] {
    return this.services.runs.states.recent().map((state) => this.run(state, now));
  }

  queue(queue: Queue): QueueView {
    const { config, tags, runs } = this.services;
    const delivery = config.delivery(queue.repository);
    return queueView(
      queue,
      (id) => runs.states.lookup(id),
      delivery.auto,
      tags.of(queue.repository),
      delivery.mode,
      runs.engine.waitOf,
      delivery.names,
      delivery.variantNames,
    );
  }

  /** The queues a new subscriber needs: those with items, places, a stop or running. */
  activeQueues(): QueueView[] {
    return this.services.queue.store
      .all()
      .filter(
        (queue) =>
          queue.items.length > 0 ||
          queue.status === 'running' ||
          queue.runs.length > 0 ||
          queue.stop !== null,
      )
      .map((queue) => this.queue(queue));
  }

  /** The observers as the settings page shows them. */
  observers(): ObserversView {
    return observersView(
      this.services.observers.settings(),
      this.services.runs.states.all(),
      this.services.observers.policy(),
    );
  }

  repositories(): RepositoryView[] {
    const { registry, runs, queue, config } = this.services;
    return repositoryViews(registry.entries(), runs.states.all(), queue.store.all(), config.home());
  }

  group(details: {
    state: RunState;
    group: Group;
    worktree: string;
    log: { seq: number; lines: string[] } | null;
  }): GroupView {
    const { state, group, worktree, log } = details;
    const { delivery, runs, now } = this.services;
    delivery.diffs.ensure(state);
    return groupView(
      state,
      group,
      worktree,
      log,
      now(),
      delivery.diffs.diffOf(state.run.id, group.slug),
      runs.engine.waitOf,
    );
  }

  /** Whether `queue_return` would take the run: something to retry, and not in its queue yet. */
  private returnable(state: RunState): boolean {
    const queue = this.services.queue.store.get(state.run.repository);
    if (!queue) return retryableGroups(state).length > 0;
    return canReturn(queue, state);
  }
}
