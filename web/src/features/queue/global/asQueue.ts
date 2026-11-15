import type { Api } from '../../../shared/api/api.ts';
import type {
  GlobalQueueView,
  PipelinesView,
  QueueView,
  RunView,
} from '../../../shared/api/types.ts';
import type { ItemScope } from '../list/itemScope.ts';
import { parentChoices } from '../queueLinks.ts';

/**
 * The global queue in the shape of a project queue, for the parts of the page that read the
 * state, the parallelism and the stop reason.
 */
export function asQueue(queue: GlobalQueueView): QueueView {
  const { max: _max, filter, ...rest } = queue;
  return {
    ...rest,
    scope: 'project',
    repository: '',
    autoDeliver: null,
    deliveryMode: null,
    filter: { pipelines: filter.pipelines, tags: filter.tags },
    filterTags: [],
  };
}

/** The line of one project in the global queue: its tasks and runs, in the global order. */
export function lineOf(queue: GlobalQueueView, repository: string): QueueView {
  const line = asQueue(queue);
  return {
    ...line,
    repository,
    items: queue.items.filter((item) => item.repository === repository),
    runs: queue.runs.filter((run) => run.repository === repository),
    skipped: queue.skipped.filter((run) => run.repository === repository),
  };
}

/** The project of a task or a run of the global queue. */
export function repositoryOf(queue: GlobalQueueView, id: string): string {
  const found = [...queue.items, ...queue.runs, ...queue.skipped].find((entry) => entry.id === id);
  return found?.repository ?? '';
}

/** A task of the global queue is handled through the api, line, pipelines and parents of its project. */
export function globalScope(
  api: Api,
  queue: GlobalQueueView,
  pipelines: ReadonlyMap<string, PipelinesView>,
  runs: readonly RunView[],
): ItemScope {
  const of = (item: { id: string }) => repositoryOf(queue, item.id);
  return {
    apiOf: (item) => api.forRepository(of(item)),
    queueOf: (item) => lineOf(queue, of(item)),
    pipelinesOf: (item) => pipelines.get(of(item)) ?? null,
    parentsOf: (item) => parentChoices(runs, of(item)),
    projectOf: of,
  };
}
