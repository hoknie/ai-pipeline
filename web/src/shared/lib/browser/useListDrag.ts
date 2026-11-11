import { useState, type DragEvent, type KeyboardEvent } from 'react';

import { dropPosition, dropSlot } from '../listOrder.ts';

type Drop = { index: number; after: boolean } | null;

/**
 * Dragging a row over a list, dropping it, and moving it with Alt and the arrow keys.
 * `keys` are the keys of the rows in order; `move` gets the key and the 1-based position.
 */
export function useListDrag(
  keys: readonly string[],
  move: (key: string, position: number) => void | Promise<void>,
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
    const key = dragging;
    if (key === null) {
      setDrop(null);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const slot = dropSlot([box.top + box.height / 2], event.clientY) + index;
    const from = keys.indexOf(key);
    setDragging(null);
    setDrop(null);
    if (from === -1) return;
    const position = dropPosition(from, slot);
    if (position !== null) void move(key, position);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, key: string, at: number) => {
    if (!event.altKey || event.target !== event.currentTarget) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      void move(key, at);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      void move(key, at + 2);
    }
  };
  const onDragEnd = () => {
    setDragging(null);
    setDrop(null);
  };
  return { dragging, setDragging, drop, onDragOver, onDrop, onKeyDown, onDragEnd };
}
