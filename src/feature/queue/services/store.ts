import type { RunStates } from '../../runs/services/index.ts';
import type { QueuePublishPort } from '../ports/index.ts';
import type { QueueRepository } from '../repositories/index.ts';
import { emptyQueue, type Queue } from '../types/index.ts';

export interface QueueStoreDependencies {
  queues: QueueRepository;
  states: RunStates;
  now: () => number;
  publish: QueuePublishPort;
}

/** The queues of the repositories, kept in memory and in the database. */
export class QueueStore {
  private readonly dependencies: QueueStoreDependencies;
  private readonly queues = new Map<string, Queue>();

  constructor(dependencies: QueueStoreDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads the queues from the database; called once at the start. */
  load(): void {
    for (const queue of this.dependencies.queues.queues()) this.queues.set(queue.repository, queue);
  }

  /** The queue of the repository when it is in memory. */
  get(repository: string): Queue | undefined {
    return this.queues.get(repository);
  }

  all(): Queue[] {
    return [...this.queues.values()];
  }

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

  /** Writes the queue and tells the clients. */
  save(queue: Queue): Queue {
    this.dependencies.queues.saveQueue(queue);
    this.dependencies.publish.queueSaved(queue);
    return queue;
  }

  /** Writes the queue without telling the clients: a save that tells them comes later. */
  write(queue: Queue): void {
    this.dependencies.queues.saveQueue(queue);
  }

  /** Tells the clients about the queue when it looks different to them. */
  check(queue: Queue): void {
    this.dependencies.publish.queueChecked(queue);
  }

  /** Drops a removed tag from the stored items; no transaction of its own. */
  dropItemTag(repository: string, id: string): void {
    this.dependencies.queues.dropItemTag(repository, id);
  }

  /** Drops a removed tag from the stored filters; no transaction of its own. */
  dropFilterTag(repository: string, id: string): void {
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
  }
}
