import type { QueueStoreDependencies, QueueStore } from './store.ts';
import {
  absorbLine,
  globalOrder,
  lineOf,
  takesProject,
  type Queue,
  type QueueItem,
} from '../types/index.ts';

/** What a line of the global queue stood on when it was built. */
interface LineInfo {
  /** Ids of the items the line had. */
  ids: Set<string>;
  /** The line holds every waiting task: its order is the global order. */
  full: boolean;
}

/** The lines of the global queue: a `Queue` that holds the global queue and the tasks of the projects. */
export class StoreLines {
  private readonly store: QueueStore;
  private readonly dependencies: QueueStoreDependencies;
  private readonly lines = new WeakMap<Queue, LineInfo>();

  constructor(store: QueueStore, dependencies: QueueStoreDependencies) {
    this.store = store;
    this.dependencies = dependencies;
  }

  /**
   * The queue that moves the runs of the repository: its own queue in the project mode, and in the
   * global mode a line of the global queue (a `Queue` that holds the state of the global queue and
   * the waiting tasks of all projects). `enabled` leaves out the tasks of projects the global
   * queue does not take: a disabled project and a project the filter does not name.
   */
  line(repository: string, enabled?: (repository: string) => boolean): Queue {
    const { store } = this;
    if (store.scope() === 'project') return store.of(repository);
    const filter = store.globalQueue().filter;
    const entries = globalOrder(store.all()).filter(
      (entry) =>
        enabled === undefined ||
        (enabled(entry.repository) && takesProject(filter, entry.repository)),
    );
    const line = lineOf(
      store.globalQueue(),
      entries.map((entry) => entry.item),
    );
    this.lines.set(line, { ids: new Set(line.items.map((item) => item.id)), full: !enabled });
    return line;
  }

  /** Queues whose items wait for `ref` (an item or a run), other than the queue of `repository`. */
  waitingFor(ref: string, repository?: string): Queue[] {
    return this.store
      .all()
      .filter(
        (queue) =>
          queue.repository !== repository && queue.items.some((item) => item.after.includes(ref)),
      );
  }

  /**
   * The queue that holds the item. In the global mode the item may stand in the queue of another
   * project than `repository`; otherwise, or when nobody holds it, the queue of `repository`.
   */
  ownerOf(repository: string, item: string): Queue {
    if (this.store.scope() === 'global') {
      const owner = this.store
        .all()
        .find((queue) => queue.items.some((other) => other.id === item));
      if (owner) return owner;
    }
    return this.store.of(repository);
  }

  /** Tells the clients about the queue (a line or the queue of a project) when it looks different to them. */
  check(queue: Queue): void {
    if (this.lines.has(queue)) this.dependencies.publish.globalQueueChecked();
    else this.dependencies.publish.queueChecked(queue);
  }

  /** Whether the queue is a line of the global queue. */
  owns(queue: Queue): boolean {
    return this.lines.has(queue);
  }

  /** The repository whose queue holds the item: the queue itself, or the owner of a line's item. */
  repositoryOf(queue: Queue, item: QueueItem): string {
    if (!this.lines.has(queue)) return queue.repository;
    for (const candidate of this.store.all()) {
      if (candidate.items.some((other) => other.id === item.id)) return candidate.repository;
    }
    const run = item.run === null ? undefined : this.dependencies.states.lookup(item.run);
    return run?.run.repository ?? queue.repository;
  }

  /**
   * Takes what a line was changed to back into the global queue and the queues of the projects:
   * its state, the items that left it, the items that joined it and the order.
   */
  commit(line: Queue, announce: boolean): void {
    const { store } = this;
    const info = this.lines.get(line)!;
    const { queues, states, publish } = this.dependencies;
    absorbLine(store.globalQueue(), line);
    const touched = new Set<Queue>();
    const present = new Set(line.items.map((item) => item.id));
    for (const queue of store.all()) {
      const kept = queue.items.filter((item) => !info.ids.has(item.id) || present.has(item.id));
      if (kept.length !== queue.items.length) {
        queue.items = kept;
        touched.add(queue);
      }
    }
    const owned = new Set(store.all().flatMap((queue) => queue.items.map((item) => item.id)));
    const added = line.items.filter((item) => !info.ids.has(item.id) && !owned.has(item.id));
    const firstOld = line.items.findIndex((item) => info.ids.has(item.id));
    for (const item of added) {
      const run = item.run === null ? undefined : states.lookup(item.run);
      if (!run) continue;
      store.of(run.run.repository).items.push(item);
      touched.add(store.of(run.run.repository));
      if (!info.full) {
        item.globalPosition = line.items.indexOf(item) < firstOld || firstOld < 0 ? -1 : Infinity;
      }
    }
    const before = new Map(
      store.all().flatMap((queue) => queue.items.map((item) => [item.id, item.globalPosition])),
    );
    if (info.full) {
      line.items.forEach((item, index) => {
        item.globalPosition = index + 1;
      });
    } else {
      globalOrder(store.all()).forEach((entry, index) => {
        entry.item.globalPosition = index + 1;
      });
    }
    for (const queue of store.all()) {
      if (queue.items.some((item) => before.get(item.id) !== item.globalPosition)) {
        touched.add(queue);
      }
    }
    for (const queue of touched) queues.saveQueue(queue);
    queues.saveGlobal(store.globalQueue());
    info.ids = new Set(line.items.map((item) => item.id));
    if (!announce) return;
    for (const queue of touched) publish.queueSaved(queue);
    publish.globalQueueSaved();
  }
}
