import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { QueueItemView, QueueView } from '../../../shared/api/types.ts';
import type { ItemScope } from './itemScope.ts';
import { moveId } from '../../../shared/lib/listOrder.ts';

export type QueueNotice = {
  message: string | null;
  setMessage: (message: string | null) => void;
  refresh: () => Promise<void>;
};

/** The shown order of the items (own moves first, the queue's truth after) and moving an item. */
export function useQueueOrder(
  scope: ItemScope,
  queue: QueueView,
  onQueue: (queue: QueueView) => void,
  notice: QueueNotice,
  /** Hides the items that do not pass; the hidden ones keep their places when the others move. */
  visible?: (item: QueueItemView) => boolean,
) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<string[] | null>(null);
  const inFlight = useRef(false);
  // a new queue (an event, another client) is the truth, except while our own move is on its way
  useEffect(() => {
    if (!inFlight.current) setOrder(null);
  }, [queue.items]);

  const byId = new Map(queue.items.map((item) => [item.id, item]));
  const shown = (order ?? queue.items.map((item) => item.id))
    .map((id) => byId.get(id))
    .filter((item): item is QueueItemView => item !== undefined);
  for (const item of queue.items) if (!shown.includes(item)) shown.push(item);
  const listed = visible === undefined ? shown : shown.filter(visible);

  /** `position` counts the listed items; the request counts all of them, hidden ones included. */
  const move = async (id: string, position: number) => {
    const ids = shown.map((item) => item.id);
    const shownIds = listed.map((item) => item.id);
    const listedFrom = shownIds.indexOf(id);
    if (
      listedFrom === -1 ||
      position < 1 ||
      position > shownIds.length ||
      position - 1 === listedFrom
    ) {
      return;
    }
    // the item takes the place of the listed neighbour it is dropped on; the hidden ones stay
    const absolute = ids.indexOf(shownIds[position - 1] as string) + 1;
    setOrder(moveId(ids, ids.indexOf(id), absolute));
    notice.setMessage(null);
    inFlight.current = true;
    try {
      onQueue(
        await scope.apiOf(byId.get(id) as QueueItemView).queueEdit(id, { position: absolute }),
      );
    } catch (failure) {
      notice.setMessage(t('queue.list.moveFailed', { error: (failure as Error).message }));
      void notice.refresh();
    } finally {
      inFlight.current = false;
      setOrder(null);
    }
  };
  return { shown: listed, move };
}
