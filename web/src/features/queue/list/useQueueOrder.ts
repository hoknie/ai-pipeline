import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { QueueItemView, QueueView } from '../../../shared/api/types.ts';
import { moveId } from '../../../shared/lib/listOrder.ts';

export type QueueNotice = {
  message: string | null;
  setMessage: (message: string | null) => void;
  refresh: () => Promise<void>;
};

/** The shown order of the items (own moves first, the queue's truth after) and moving an item. */
export function useQueueOrder(
  api: Api,
  queue: QueueView,
  onQueue: (queue: QueueView) => void,
  notice: QueueNotice,
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

  const move = async (id: string, position: number) => {
    const ids = shown.map((item) => item.id);
    const from = ids.indexOf(id);
    if (from === -1 || position < 1 || position > ids.length || position - 1 === from) return;
    setOrder(moveId(ids, from, position));
    notice.setMessage(null);
    inFlight.current = true;
    try {
      onQueue(await api.queueEdit(id, { position }));
    } catch (failure) {
      notice.setMessage(t('queue.list.moveFailed', { error: (failure as Error).message }));
      void notice.refresh();
    } finally {
      inFlight.current = false;
      setOrder(null);
    }
  };
  return { shown, move };
}
