import type { RunStates } from '../../runs/services/index.ts';
import { runTitle } from '../../runs/types/index.ts';
import type { TaskLinksRepository } from '../repositories/index.ts';
import {
  dependencyState,
  linkViews,
  normalizeLinks,
  type TaskLink,
  type TaskLinkView,
  type TaskRefInfo,
} from '../types/index.ts';

import type { QueueStore } from './store.ts';

export interface LinkIndexDependencies {
  links: TaskLinksRepository;
  store: QueueStore;
  states: RunStates;
}

/** The links of the tasks by source and by target, rebuilt when the table changes. */
export class LinkIndex {
  private readonly dependencies: LinkIndexDependencies;
  private built = -1;
  private bySource = new Map<string, TaskLink[]>();
  private byTarget = new Map<string, TaskLink[]>();

  constructor(dependencies: LinkIndexDependencies) {
    this.dependencies = dependencies;
  }

  /** The links that start at `id`, in order. */
  from(id: string): readonly TaskLink[] {
    this.refresh();
    return this.bySource.get(id) ?? [];
  }

  /** The links that end at `id`, in order. */
  to(id: string): readonly TaskLink[] {
    this.refresh();
    return this.byTarget.get(id) ?? [];
  }

  /** The parent of a task, if it has one. */
  parentOf(id: string): string | undefined {
    return this.from(id).find((link) => link.kind === 'parent')?.target;
  }

  /** Every task that has a link with `id`. */
  neighbours(id: string): string[] {
    return [
      ...new Set([
        ...this.from(id).map((link) => link.target),
        ...this.to(id).map((link) => link.source),
      ]),
    ];
  }

  /**
   * `links` and `linkedBy` of a task; the ids of a returned run's item and of the run itself share
   * one list.
   */
  viewsOf(...ids: string[]): { links: TaskLinkView[]; linkedBy: TaskLinkView[] } {
    const { store, states } = this.dependencies;
    const own = new Set(ids);
    const out = normalizeLinks(ids.flatMap((id) => this.from(id)));
    const into = normalizeLinks(ids.flatMap((id) => this.to(id)));
    return linkViews({ out, into }, (other, link, outgoing) => ({
      ...this.describe(other),
      ...(outgoing && link.kind === 'blocked_by' && !own.has(other)
        ? { state: dependencyState(store.findItem, other, (id) => states.lookup(id)) }
        : {}),
    }));
  }

  /** What is known about the other end of a link. */
  describe(id: string): TaskRefInfo {
    const found = this.dependencies.store.findItem(id);
    if (found) {
      const { item } = found;
      const label = item.title ?? (item.task ? item.task.trim().split('\n')[0] : null);
      return {
        ref: 'item',
        number: item.number,
        title: label ?? item.pipeline,
        repository: found.queue.repository,
      };
    }
    const run = this.dependencies.states.lookup(id);
    if (run) {
      return {
        ref: 'run',
        number: run.run.number,
        title: runTitle(run),
        repository: run.run.repository,
      };
    }
    return { ref: null, number: null, title: id, repository: null };
  }

  private refresh(): void {
    const { links } = this.dependencies;
    if (this.built === links.version) return;
    this.built = links.version;
    this.bySource = new Map();
    this.byTarget = new Map();
    for (const link of normalizeLinks(links.all())) {
      this.bySource.set(link.source, [...(this.bySource.get(link.source) ?? []), link]);
      this.byTarget.set(link.target, [...(this.byTarget.get(link.target) ?? []), link]);
    }
  }
}
