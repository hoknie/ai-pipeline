import type { Content, PhrasingContent, ListItem } from 'mdast';
import type { Mark, Node } from 'prosemirror-model';
import { editorSchema as schema } from './editorSchema.ts';
import { isSafeLink } from './linkEditing.ts';

type Source = { markdown: string; offset: number };

function original(node: Content, source: Source): string {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  if (from === undefined || to === undefined) throw new Error('Missing Markdown source range');
  return source.markdown.slice(from - source.offset, to - source.offset);
}

function inline(
  nodes: readonly PhrasingContent[],
  source: Source,
  marks: readonly Mark[] = [],
): Node[] {
  return nodes.flatMap((node): Node[] => {
    if (node.type === 'text') return node.value ? [schema.text(node.value, marks)] : [];
    if (node.type === 'break') return [schema.node('hard_break', null, undefined, marks)];
    if (node.type === 'inlineCode')
      return node.value ? [schema.text(node.value, [...marks, schema.marks.code!.create()])] : [];
    const mark =
      node.type === 'strong'
        ? schema.marks.strong!.create()
        : node.type === 'emphasis'
          ? schema.marks.em!.create()
          : node.type === 'delete'
            ? schema.marks.strike!.create()
            : node.type === 'link' && isSafeLink(node.url)
              ? schema.marks.link!.create({ href: node.url, title: node.title ?? null })
              : null;
    if (mark && 'children' in node)
      return inline(node.children as PhrasingContent[], source, [...marks, mark]);
    return [schema.node('raw_inline', { raw: original(node, source) }, undefined, marks)];
  });
}

function listItem(item: ListItem, source: Source): Node {
  let checked = item.checked ?? null;
  const children = [...item.children];
  const paragraph = children[0];
  const first = paragraph?.type === 'paragraph' ? paragraph.children[0] : null;
  if (paragraph?.type === 'paragraph' && first?.type === 'text') {
    let value = first.value;
    const emptyTask = /^\[([ xX])\](?:\s+|$)/.exec(value);
    if (checked === null && emptyTask && original(first, source).startsWith('[')) {
      checked = emptyTask[1]!.toLowerCase() === 'x';
      value = value.slice(3);
    }
    if (checked !== null) {
      const rest = paragraph.children.slice(1);
      value = value.replace(/^\s+/, '');
      children[0] = { ...paragraph, children: value ? [{ ...first, value }, ...rest] : rest };
    }
  }
  return schema.node(
    'list_item',
    { checked },
    children.length
      ? children.map((child) => mdastBlock(child, source))
      : [schema.node('paragraph')],
  );
}

/** Build only understood structure. Unknown inline fragments remain atoms inside editable blocks. */
export function mdastBlock(node: Content, source: Source): Node {
  switch (node.type) {
    case 'paragraph':
      return schema.node('paragraph', null, inline(node.children, source));
    case 'heading':
      return schema.node('heading', { level: node.depth }, inline(node.children, source));
    case 'thematicBreak':
      return schema.node('horizontal_rule');
    case 'blockquote':
      return schema.node(
        'blockquote',
        null,
        node.children.map((child) => mdastBlock(child, source)),
      );
    case 'list':
      return schema.node(
        node.ordered ? 'ordered_list' : 'bullet_list',
        {
          order: node.start ?? 1,
          tight: !node.spread,
        },
        node.children.map((item) => listItem(item, source)),
      );
    case 'table':
      return schema.node(
        'table',
        null,
        node.children.map((row, index) =>
          schema.node(
            'table_row',
            null,
            row.children.map((cell, column) =>
              schema.node(
                index === 0 ? 'table_header' : 'table_cell',
                { align: node.align?.[column] ? `text-align:${node.align[column]}` : null },
                inline(cell.children, source),
              ),
            ),
          ),
        ),
      );
    default:
      return schema.node('raw_block', {
        raw: original(node, source),
        code: node.type === 'code' ? node.value : null,
        language: node.type === 'code' ? node.lang : null,
      });
  }
}
