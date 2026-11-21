import type { Group, RunState } from '../../feature/runs/types/index.ts';
import type { Queue } from '../../feature/queue/types/index.ts';
import { GLOBAL_KEY, returnItemOf, canReturn } from '../../feature/queue/types/index.ts';
import { retryableGroups } from '../../feature/runs/types/index.ts';
import type {
  GlobalQueueView,
  GroupView,
  ObserversView,
  QueueView,
  RepositoryView,
  RunView,
} from './contract/index.ts';
import type { AuthorView } from './contract/index.ts';
import type { DaemonServices } from './services.ts';
import {
  globalQueueView,
  groupView,
  observersView,
  queueView,
  repositoryViews,
  runView,
  withLinks,
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
    const linked = withLinks(
      view,
      queue.links.index.viewsOf(...[state.run.id, ...(item ? [item.id] : [])]),
    );
    return withQueue(
      { ...linked, author: this.author(state.run.author), returnable: this.returnable(state) },
      item?.id ?? null,
    );
  }

  /** The recent runs, the latest first. */
  recentRuns(now = this.services.now()): RunView[] {
    return this.services.runs.states.recent().map((state) => this.run(state, now));
  }

  queue(queue: Queue): QueueView {
    const { config, tags, runs } = this.services;
    const delivery = config.delivery(queue.repository);
    const view = queueView(
      queue,
      (id) => runs.states.lookup(id),
      delivery.auto,
      tags.of(queue.repository),
      delivery.mode,
      runs.engine.waitOf,
      delivery.names,
      delivery.variantNames,
      (item) => this.services.attachments.listOf(item),
      this.services.queue.store.findItem,
      (ids) => this.services.queue.links.index.viewsOf(...ids),
      delivery.providerNames,
    );
    return { ...view, items: this.withAuthors(view.items) };
  }

  /** The global queue as clients see it; its tasks are those of every project. */
  globalQueue(): GlobalQueueView {
    const { config, tags, runs, queue } = this.services;
    const line = queue.store.lines.line(GLOBAL_KEY);
    const delivery = (repository: string) => config.delivery(repository);
    const settings = config.queueSettings();
    const view = globalQueueView(queue.store.globalQueue(), line, {
      lookup: (id) => runs.states.lookup(id),
      waits: runs.engine.waitOf,
      attachments: (item) => this.services.attachments.listOf(item),
      find: queue.store.findItem,
      links: (ids) => queue.links.index.viewsOf(...ids),
      max: typeof settings === 'string' ? 5 : settings.max,
      ownerOf: (item) => queue.store.lines.repositoryOf(line, item),
      project: (repository) => ({
        names: delivery(repository).names,
        variantNames: delivery(repository).variantNames,
        providerNames: delivery(repository).providerNames,
        catalog: tags.of(repository),
      }),
    });
    return { ...view, items: this.withAuthors(view.items) };
  }

  /** The answer of a queue request: the queue of the project, or the global queue in its mode. */
  queueAnswer(queue: Queue): QueueView | GlobalQueueView {
    return this.services.queue.store.scope() === 'global' ? this.globalQueue() : this.queue(queue);
  }

  /** The queues a new subscriber needs: those with items, places, a stop or running. */
  activeQueues(): QueueView[] {
    // In the global mode the queues of the projects are not shown: the global queue is.
    if (this.services.queue.store.scope() === 'global') return [];
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

  /** The author of a task or a run by the id of the user; `null` for none or for an id nobody knows. */
  private author(id: string | null): AuthorView | null {
    if (id === null) return null;
    const user = this.services.identity.users.byId(id);
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name, disabled: user.disabled };
  }

  /** The items of a queue with their authors; the author of an item never changes, so it is read from the item. */
  private withAuthors<T extends { id: string }>(items: T[]): (T & { author: AuthorView | null })[] {
    const find = this.services.queue.store.findItem;
    return items.map((view) => ({
      ...view,
      author: this.author(find(view.id)?.item.author ?? null),
    }));
  }

  /** Whether `queue_return` would take the run: something to retry, and not in its queue yet. */
  private returnable(state: RunState): boolean {
    const queue = this.services.queue.store.get(state.run.repository);
    if (!queue) return retryableGroups(state).length > 0 && state.run.cleanedAt === null;
    return canReturn(queue, state);
  }
}
