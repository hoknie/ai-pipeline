import type { KeyboardEvent } from 'react';

import type { QueueItemView } from '../../../shared/api/types.ts';
import { useListDrag } from '../../../shared/lib/browser/useListDrag.ts';

/** Dragging an item over the list, dropping it, and moving it with Alt and the arrow keys. */
export function useQueueDrag(
  shown: QueueItemView[],
  move: (id: string, position: number) => Promise<void>,
) {
  const drag = useListDrag(
    shown.map((item) => item.id),
    move,
  );
  return {
    ...drag,
    onKeyDown: (event: KeyboardEvent<HTMLLIElement>, item: QueueItemView, at: number) =>
      drag.onKeyDown(event, item.id, at),
  };
}

export type QueueDrag = ReturnType<typeof useQueueDrag>;
