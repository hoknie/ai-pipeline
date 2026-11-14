/** Puts the focus in the first field of the new task form: the text, or the first group. */
export function focusNewTaskField(mode: 'task' | 'groups'): void {
  const field = mode === 'task' ? '#new-task' : '#new-group-0-title';
  document.querySelector<HTMLElement>(field)?.focus();
}
