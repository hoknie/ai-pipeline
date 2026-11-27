import { redo, undo } from 'prosemirror-history';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { editorSchema as schema } from '../../../lib/markdown/editorSchema.ts';
import { commands } from './commands.ts';

/** Physical Latin shortcuts also work while a non-Latin keyboard layout is active. */
export function shortcutKey(event: KeyboardEvent): string {
  const key = event.key.toLowerCase();
  return /^[a-z]$/.test(key)
    ? key
    : /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : key;
}

const splitTask: Command = (state, dispatch, view) => {
  const { $from } = state.selection;
  const parent = $from.depth >= 2 ? $from.node(-1) : null;
  const task =
    parent !== null && parent.type === schema.nodes.list_item && parent.attrs.checked != null;
  return splitListItem(schema.nodes.list_item!)(
    state,
    dispatch &&
      ((tr) => {
        if (task) {
          const $cursor = tr.selection.$from;
          for (let depth = $cursor.depth; depth > 0; depth--) {
            const node = $cursor.node(depth);
            if (node.type === schema.nodes.list_item) {
              tr.setNodeMarkup($cursor.before(depth), undefined, { ...node.attrs, checked: false });
              break;
            }
          }
        }
        dispatch(tr);
      }),
    view,
  );
};

export const listKeys = {
  Enter: splitTask,
  Tab: sinkListItem(schema.nodes.list_item!),
  'Shift-Tab': liftListItem(schema.nodes.list_item!),
};

export function editorKeyDown(
  view: EditorView,
  event: KeyboardEvent,
  disabled: boolean | undefined,
  onLink?: (view: EditorView) => void,
) {
  if (disabled || (!event.ctrlKey && !event.metaKey) || event.altKey) return false;
  const key = shortcutKey(event);
  if (key === 'k' && !event.shiftKey && onLink) {
    onLink(view);
    return true;
  }
  const command =
    key === 'z'
      ? event.shiftKey
        ? redo
        : undo
      : key === 'y' && !event.shiftKey
        ? redo
        : key === 'b' && !event.shiftKey
          ? commands.bold
          : key === 'i' && !event.shiftKey
            ? commands.italic
            : key === 'k' && !event.shiftKey
              ? commands.link
              : undefined;
  if (!command) return false;
  command(view.state, view.dispatch, view);
  return true;
}
