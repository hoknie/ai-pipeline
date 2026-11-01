/**
 * Insertion slot for a pointer at `y`: 0 is before the first item, `n` after the last.
 * `middles` are the vertical centres of the items in order.
 */
export function dropSlot(middles: readonly number[], y: number): number {
  return middles.filter((middle) => y > middle).length;
}

/**
 * 1-based position an item moves to when it is dropped into `slot`, or null when
 * it stays where it is. `from` is the 0-based index of the dragged item.
 */
export function dropPosition(from: number, slot: number): number | null {
  const target = slot > from ? slot - 1 : slot;
  return target === from ? null : target + 1;
}

/** The ids with the one at `from` moved to the 1-based `position`. */
export function moveId(ids: readonly string[], from: number, position: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(position - 1, 0, moved);
  return next;
}
