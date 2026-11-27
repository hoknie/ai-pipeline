import type { Content, Text, InlineCode } from 'mdast';
import type { Node } from 'prosemirror-model';
import type { EditorSourceBlock } from './editorSource.ts';
import { editorMarkdownSerializer, editorSchema } from './editorSchema.ts';
import { parseEditorDocument } from './editorDocument.ts';

function textLeaves(node: Content): (Text | InlineCode)[] {
  if (node.type === 'text' || node.type === 'inlineCode') return [node];
  if (node.type === 'link' && !/^(https?:|mailto:|\/|#)/i.test(node.url)) return [];
  if (
    ![
      'paragraph',
      'heading',
      'strong',
      'emphasis',
      'delete',
      'link',
      'list',
      'listItem',
      'blockquote',
      'table',
      'tableRow',
      'tableCell',
    ].includes(node.type) ||
    !('children' in node)
  )
    return [];
  return node.children.flatMap((child) => textLeaves(child));
}

/** Locate a single text-only edit without changing its surrounding Markdown delimiters. */
export function preserveTextRange(
  block: EditorSourceBlock,
  previous: Node,
  next: Node,
): string | null {
  const leaves = textLeaves(block.node);
  let index = 0;
  let changed: { leaf: Text | InlineCode; before: string; after: string } | null = null;
  function compare(before: Node, after: Node): boolean {
    if (!before.sameMarkup(after) || before.childCount !== after.childCount) return false;
    if (before.isText) {
      const leaf = leaves[index++];
      if (!leaf || leaf.value !== before.text) return false;
      if (before.text !== after.text) {
        if (changed) return false;
        changed = { leaf, before: before.text!, after: after.text! };
      }
      return true;
    }
    for (let i = 0; i < before.childCount; i++)
      if (!compare(before.child(i), after.child(i))) return false;
    return true;
  }
  if (!compare(previous, next) || !changed || index !== leaves.length) return null;
  // Assignment happens in compare; keep the checked value explicit for TS control flow.
  const edit = changed as { leaf: Text | InlineCode; before: string; after: string };
  const from = edit.leaf.position?.start.offset;
  const to = edit.leaf.position?.end.offset;
  if (
    edit.leaf.type !== 'text' ||
    from === undefined ||
    to === undefined ||
    block.raw.slice(from - block.from, to - block.from) !== edit.before
  )
    return null;
  let prefix = 0;
  while (
    prefix < edit.before.length &&
    prefix < edit.after.length &&
    edit.before[prefix] === edit.after[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < edit.before.length - prefix &&
    suffix < edit.after.length - prefix &&
    edit.before.at(-suffix - 1) === edit.after.at(-suffix - 1)
  )
    suffix++;
  const inserted = edit.after.slice(prefix, edit.after.length - suffix);
  if (/[\r\n]/.test(inserted)) return null;
  const escaped = inserted
    ? editorMarkdownSerializer.serialize(
        editorSchema.node('doc', null, [
          editorSchema.node('paragraph', null, [editorSchema.text(inserted)]),
        ]),
      )
    : '';
  const candidate =
    block.raw.slice(0, from - block.from + prefix) +
    escaped +
    block.raw.slice(to - block.from - suffix);
  const parsed = parseEditorDocument(candidate);
  return parsed.childCount === 1 && parsed.firstChild!.eq(next) ? candidate : null;
}
