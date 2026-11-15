import type { GlobalQueueView, QueueView } from '../../../shared/api/types.ts';

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
    filter: { pipelines: filter.pipelines, tags: [] },
    filterTags: [],
  };
}
