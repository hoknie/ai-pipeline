import { conflict, type AppError } from '../../../platform/errors/index.ts';
import type { NewGroup } from '../../runs/types/index.ts';
import { DEFAULT_VARIANT } from '../../swarm-config/types/index.ts';

import type { Queue, QueueItem } from './items.ts';

/** The code of the refusal of a task that already waits in the queue. */
export const DUPLICATE_TASK_CODE = 'queue.duplicate_task';

/** What makes two tasks the same one: the pipeline, the variant, the provider and the content. */
export interface TaskIdentity {
  pipeline: string;
  variant?: string | undefined;
  provider?: string | null | undefined;
  task?: string | null | undefined;
  groups?: NewGroup[] | null | undefined;
}

function sameGroups(left: NewGroup[], right: NewGroup[]): boolean {
  return (
    left.length === right.length &&
    left.every((group, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        group.title.trim() === other.title.trim() &&
        group.task.trim() === other.task.trim()
      );
    })
  );
}

/** The same text without the spaces around it, or the same groups in the same order. */
function sameContent(left: TaskIdentity, right: TaskIdentity): boolean {
  if (typeof left.task === 'string' && typeof right.task === 'string') {
    return left.task.trim() === right.task.trim();
  }
  if (Array.isArray(left.groups) && Array.isArray(right.groups)) {
    return sameGroups(left.groups, right.groups);
  }
  return false;
}

export function sameTask(left: TaskIdentity, right: TaskIdentity): boolean {
  return (
    left.pipeline === right.pipeline &&
    (left.variant ?? DEFAULT_VARIANT) === (right.variant ?? DEFAULT_VARIANT) &&
    (left.provider ?? null) === (right.provider ?? null) &&
    sameContent(left, right)
  );
}

/** The waiting item of the queue that is the same task; a returned run is not compared. */
export function findDuplicate(queue: Queue, task: TaskIdentity): QueueItem | undefined {
  return queue.items.find((item) => item.run === null && sameTask(item, task));
}

/** The refusal of a task whose copy waits in the queue; `where` names the project when there are several. */
export function duplicateTask(item: QueueItem, where = ''): AppError {
  return conflict(
    DUPLICATE_TASK_CODE,
    `task #${item.number} (${item.id}) with the same pipeline and task already waits in the queue${where}`,
  );
}

/** Refuses a new task that already waits in the queue, unless a copy was asked for. */
export function refuseDuplicate(
  queue: Queue,
  task: TaskIdentity,
  allowDuplicate = false,
  where = '',
): void {
  if (allowDuplicate) return;
  const waiting = findDuplicate(queue, task);
  if (waiting !== undefined) throw duplicateTask(waiting, where);
}
