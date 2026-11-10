/** Whether the key goes to a field the person types in, not to the canvas. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="listbox"], [data-canvas-inspector]',
    ) !== null
  );
}

/** Delete and Backspace remove the chosen node of the canvas. */
export function isRemoveKey(event: { key: string; target: EventTarget | null }): boolean {
  return (event.key === 'Delete' || event.key === 'Backspace') && !isEditableTarget(event.target);
}
