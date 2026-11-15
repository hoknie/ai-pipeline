import type { QueueScopeName } from '../../swarm-config/types/index.ts';
import type { RunStates } from '../../runs/services/index.ts';
import type { QueuePublishPort } from '../ports/index.ts';
import type { QueueRepository } from '../repositories/index.ts';
import { StoreLines } from './store-lines.ts';
import {
  emptyGlobalQueue,
  emptyQueue,
  itemStarted,
  lookupIn,
  placeNewItems,
  type GlobalQueue,
  type ItemLookup,
  type Queue,
  type QueueItem,
} from '../types/index.ts';

export interface QueueStoreDependencies {
  queues: QueueRepository;
  states: RunStates;
  now: () => number;
  publish: QueuePublishPort;
}

/** The queues of the repositories and the global queue, kept in memory and in the database. */
export class QueueStore {
  private readonly dependencies: QueueStoreDependencies;
  private readonly queues = new Map<string, Queue>();
  /** The lines of the global queue. */
  readonly lines: StoreLines;
  private global: GlobalQueue;

  constructor(dependencies: QueueStoreDependencies) {
    this.dependencies = dependencies;
    this.lines = new StoreLines(this, dependencies);
    this.global = emptyGlobalQueue(dependencies.now());
  }

  /** Reads the queues from the database; called once at the start. */
  load(): void {
    for (const queue of this.dependencies.queues.queues()) this.queues.set(queue.repository, queue);
    this.global = this.dependencies.queues.loadGlobal(this.dependencies.now());
  }

  /** The queue of the repository when it is in memory. */
  get(repository: string): Queue | undefined {
    return this.queues.get(repository);
  }

  all(): Queue[] {
    return [...this.queues.values()];
  }

  /** The global queue: its settings and state. */
  globalQueue(): GlobalQueue {
    return this.global;
  }

  /** The mode the daemon works in now. */
  scope(): QueueScopeName {
    return this.global.appliedScope;
  }

  /** Finds an item by id in the queues of every repository. */
  findItem: ItemLookup = (id) => lookupIn(...this.queues.values())(id);

  /** The queue of the repository: from memory, the database, or a new empty one. */
  of(repository: string): Queue {
    const cached = this.queues.get(repository);
    if (cached) return cached;
    const { queues, states, now } = this.dependencies;
    const next = Math.max(states.maxNumber(repository), queues.maxItemNumber(repository)) + 1;
    const queue = queues.loadQueue(repository) ?? emptyQueue(repository, now(), next);
    this.queues.set(repository, queue);
    return queue;
  }

  /** The item became a run: items of other queues that waited for it wait for the run; those queues are saved and returned. */
  itemStarted(queue: Queue, item: string, run: string): Queue[] {
    const touched = itemStarted(queue, item, run, this.dependencies.now(), this.all());
    for (const other of touched) this.save(other);
    return touched;
  }

  /** Writes the queue and tells the clients. */
  save(queue: Queue): Queue {
    if (this.lines.owns(queue)) {
      this.lines.commit(queue, true);
      return queue;
    }
    this.place(queue);
    this.dependencies.queues.saveQueue(queue);
    this.dependencies.publish.queueSaved(queue);
    if (this.scope() === 'global') this.dependencies.publish.globalQueueChecked();
    return queue;
  }

  /** Writes the queue without telling the clients: a save that tells them comes later. */
  write(queue: Queue): void {
    if (this.lines.owns(queue)) {
      this.lines.commit(queue, false);
      return;
    }
    this.place(queue);
    this.dependencies.queues.saveQueue(queue);
  }

  /** Writes the global queue and every queue without telling the clients, then tells them. */
  saveEverything(): void {
    for (const queue of this.queues.values()) this.dependencies.queues.saveQueue(queue);
    this.dependencies.queues.saveGlobal(this.global);
    for (const queue of this.queues.values()) this.dependencies.publish.queueSaved(queue);
    this.dependencies.publish.globalQueueSaved();
  }

  /** Drops a removed tag from the stored items and filters; no transaction of its own. */
  dropTag(repository: string, id: string): void {
    this.dependencies.queues.dropItemTag(repository, id);
    this.dependencies.queues.dropFilterTag(repository, id);
  }

  /** The queue of a project that moved, stored and in memory; no transaction of its own. */
  moveRepository(from: string, to: string): void {
    this.dependencies.queues.moveQueue(from, to);
    const queue = this.queues.get(from);
    this.queues.delete(from);
    if (queue === undefined) return;
    queue.repository = to;
    this.queues.set(to, queue);
    const projects = this.global.filter.projects;
    if (projects.includes(from)) {
      this.global.filter.projects = projects.map((path) => (path === from ? to : path));
      this.dependencies.queues.saveGlobal(this.global);
    }
  }

  /** In the global mode a new task goes to the end of the global order, a returned run to its front. */
  private place(saved: Queue): void {
    if (this.scope() === 'project') return;
    if (!placeNewItems(this.all())) return;
    for (const queue of this.queues.values()) {
      if (queue !== saved) this.dependencies.queues.saveQueue(queue);
    }
  }
}
