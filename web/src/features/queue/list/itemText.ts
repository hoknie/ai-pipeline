import type { TFunction } from 'i18next';

import { taskNumber } from '../../../shared/lib/format.ts';
import type { QueueItemView, QueueView } from '../../../shared/api/types.ts';

/** `N groups` with the plural of the active language. */
export function groupsText(count: number, t: TFunction): string {
  return t('queue.list.groups', { count });
}

export function itemLabel(item: QueueItemView, t: TFunction): string {
  if (item.title) return item.title;
  if (item.groups) return groupsText(item.groups.length, t);
  return (
    (item.task ?? '')
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? ''
  );
}

/** What "run now" does when no place is free: freezes the last run that took a place, or goes over the limit. */
export function runNowTip(queue: QueueView, item: QueueItemView, t: TFunction): string | undefined {
  if (queue.runs.length < queue.parallel) return undefined;
  const frozen = queue.freezeCandidate
    ? queue.runs.find((run) => run.id === queue.freezeCandidate)
    : undefined;
  if (frozen && item.hold !== 'frozen') {
    return t('queue.list.runNowFreeze', { number: taskNumber(frozen.number) });
  }
  return t('queue.list.runNowOverflow', { taken: queue.runs.length + 1, count: queue.parallel });
}
