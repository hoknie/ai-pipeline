import type { Api } from '../../../shared/api/api.ts';
import type {
  PipelinesView,
  QueueItemView,
  QueueView,
  RunView,
} from '../../../shared/api/types.ts';

/** What a task of the list is handled through: its project's api, line, pipelines and parents. */
export type ItemScope = {
  apiOf(item: QueueItemView): Api;
  queueOf(item: QueueItemView): QueueView;
  pipelinesOf(item: QueueItemView): PipelinesView | null;
  runs: readonly RunView[];
  /** The path of the task's project for its label; without it the rows carry no label. */
  projectOf?(item: QueueItemView): string;
};

/** The scope of a queue of one project: every task is handled through that project. */
export function projectScope(
  api: Api,
  queue: QueueView,
  pipelines: PipelinesView | null,
  runs: readonly RunView[],
): ItemScope {
  return {
    apiOf: () => api,
    queueOf: () => queue,
    pipelinesOf: () => pipelines,
    runs,
  };
}
