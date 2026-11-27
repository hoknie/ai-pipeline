import { setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { editorSchema as schema } from '../../../lib/markdown/editorSchema.ts';
import { wrapInList } from 'prosemirror-schema-list';
import type { Command } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import type { MarkupAction } from '../../../lib/markdown/markdownMarkup.ts';

function selectedItems(tr: Transaction): number[] {
  const { $from, from, to } = tr.selection;
  const positions = new Set<number>();
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === schema.nodes.list_item) {
      positions.add($from.before(depth));
      break;
    }
  }
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === schema.nodes.list_item) positions.add(pos);
  });
  return [...positions];
}

const taskList: Command = (state, dispatch) => {
  const apply = (tr: Transaction) => {
    const positions = selectedItems(tr);
    if (!positions.length) return false;
    const remove = positions.every((pos) => tr.doc.nodeAt(pos)?.attrs.checked != null);
    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos)!;
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        checked: remove ? null : (node.attrs.checked ?? false),
      });
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
  if (selectedItems(state.tr).length) return apply(state.tr);
  const wrap = wrapInList(schema.nodes.bullet_list!);
  if (!dispatch) return wrap(state);
  return wrap(state, (tr) => {
    apply(tr);
  });
};

export const commands: Partial<Record<MarkupAction, Command>> = {
  bold: toggleMark(schema.marks.strong!),
  italic: toggleMark(schema.marks.em!),
  strike: toggleMark(schema.marks.strike!),
  code: toggleMark(schema.marks.code!),
  heading: setBlockType(schema.nodes.heading!, { level: 2 }),
  quote: wrapIn(schema.nodes.blockquote!),
  codeBlock: setBlockType(schema.nodes.code_block!),
  bulletList: wrapInList(schema.nodes.bullet_list!),
  numberedList: wrapInList(schema.nodes.ordered_list!),
  taskList: taskList,
  link: toggleMark(schema.marks.link!, { href: 'https://' }),
};
