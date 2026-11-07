import { useState, type DragEvent, type KeyboardEvent } from 'react';

import type { QueueItemView } from '../../../shared/api/types.ts';
import { dropPosition, dropSlot } from '../queueOrder.ts';

type Drop = { index: number; after: boolean } | null;

/** Dragging an item over the list, dropping it, and moving it with Alt and the arrow keys. */
export function useQueueDrag(
  shown: QueueItemView[],
  move: (id: string, position: number) => Promise<void>,
) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);

  const onDragOver = (event: DragEvent<HTMLLIElement>, index: number) => {
    if (dragging === null) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    setDrop((current) =>
      current?.index === index && current.after === after ? current : { index, after },
    );
  };

  const onDrop = (event: DragEvent<HTMLLIElement>, index: number) => {
    event.preventDefault();
    const id = dragging ?? event.dataTransfer.getData('text/plain');
    const box = event.currentTarget.getBoundingClientRect();
    const slot = dropSlot([box.top + box.height / 2], event.clientY) + index;
    const from = shown.findIndex((item) => item.id === id);
    setDragging(null);
    setDrop(null);
    if (from === -1) return;
    const position = dropPosition(from, slot);
    if (position !== null) void move(id, position);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, item: QueueItemView, at: number) => {
    if (!event.altKey || event.target !== event.currentTarget) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      void move(item.id, at);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      void move(item.id, at + 2);
    }
  };
  const onDragEnd = () => {
    setDragging(null);
    setDrop(null);
  };
  return { dragging, setDragging, drop, onDragOver, onDrop, onKeyDown, onDragEnd };
}

export type QueueDrag = ReturnType<typeof useQueueDrag>;
