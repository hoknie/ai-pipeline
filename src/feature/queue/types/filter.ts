import { rejected } from '../../../platform/errors/index.ts';
import type { Queue, QueueFilter, QueueItem } from './items.ts';

export interface QueueFilterPatch {
  pipelines?: string[] | undefined;
  tags?: string[] | undefined;
}

export function isFilterEmpty(filter: QueueFilter): boolean {
  return filter.pipelines.length === 0 && filter.tags.length === 0;
}

/**
 * Whether a running queue takes the item: its pipeline is in the filter and it has at
 * least one of the filter tags (an empty list means any). A returned run always fits.
 */
export function matchesFilter(filter: QueueFilter, item: QueueItem): boolean {
  if (item.run !== null) return true;
  if (filter.pipelines.length > 0 && !filter.pipelines.includes(item.pipeline)) return false;
  if (filter.tags.length > 0 && !item.tags.some((tag) => filter.tags.includes(tag))) return false;
  return true;
}

/** Checks the change of the filter; throws before anything is touched. */
export function checkQueueFilter(queue: Queue, patch: QueueFilterPatch): void {
  if (patch.pipelines === undefined && patch.tags === undefined) {
    throw rejected('pass filter.pipelines or filter.tags');
  }
  if (queue.status === 'running') {
    throw rejected('queue filter can be changed only while the queue is stopped');
  }
}

/** Replaces the passed lists of the filter, without repeats. */
export function setQueueFilter(queue: Queue, patch: QueueFilterPatch, now: number): void {
  checkQueueFilter(queue, patch);
  queue.filter = {
    pipelines:
      patch.pipelines === undefined ? queue.filter.pipelines : [...new Set(patch.pipelines)],
    tags: patch.tags === undefined ? queue.filter.tags : [...new Set(patch.tags)],
  };
  queue.updatedAt = now;
}
