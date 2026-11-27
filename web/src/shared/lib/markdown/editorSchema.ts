import MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type { Delimiter } from 'markdown-it/lib/rules_inline/state_inline.mjs';
import { Fragment, Schema } from 'prosemirror-model';
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
  schema as commonMarkSchema,
} from 'prosemirror-markdown';

export const editorSchema = new Schema({
  nodes: commonMarkSchema.spec.nodes
    .append({
      raw_inline: {
        group: 'inline',
        inline: true,
        atom: true,
        attrs: { raw: {} },
        leafText: (node) => node.attrs.raw,
        toDOM: (node) => [
          'span',
          { 'data-raw-inline': 'true', contenteditable: 'false' },
          node.attrs.raw,
        ],
      },
      raw_block: {
        group: 'block',
        atom: true,
        attrs: { raw: {}, code: { default: null }, language: { default: null } },
        leafText: (node) => node.attrs.raw,
        // Clipboard HTML carries source, not code containing a second Markdown fence.
        toDOM: (node) => ['pre', { 'data-raw-markdown': 'true' }, node.attrs.raw],
      },
      table: { content: 'table_row+', group: 'block', toDOM: () => ['table', ['tbody', 0]] },
      table_row: { content: '(table_header | table_cell)+', toDOM: () => ['tr', 0] },
      table_header: {
        content: 'inline*',
        attrs: { align: { default: null } },
        toDOM: (node) => ['th', { style: node.attrs.align }, 0],
      },
      table_cell: {
        content: 'inline*',
        attrs: { align: { default: null } },
        toDOM: (node) => ['td', { style: node.attrs.align }, 0],
      },
    })
    .update('list_item', {
      ...commonMarkSchema.spec.nodes.get('list_item')!,
      attrs: { checked: { default: null } },
      toDOM(node) {
        if (node.attrs.checked === null) return ['li', 0];
        return [
          'li',
          { 'data-task': 'true' },
          [
            'input',
            {
              type: 'checkbox',
              checked: node.attrs.checked ? 'checked' : null,
              contenteditable: 'false',
            },
          ],
          ['div', 0],
        ];
      },
    }),
  marks: commonMarkSchema.spec.marks.addBefore('code', 'strike', {
    parseDOM: [{ tag: 'del' }, { tag: 's' }, { tag: 'strike' }],
    toDOM: () => ['del', 0],
  }),
});

// GFM accepts matching runs of one or two tildes; runs of different lengths
// must not pair. markdown-it's built-in strike rule only accepts pairs.
const singleTilde = 0x1007e;
const doubleTilde = 0x1007f;
const tokenizer = MarkdownIt('commonmark', { html: false });
tokenizer.enable('table');
tokenizer.inline.ruler.at('strikethrough', (state, silent) => {
  if (silent || state.src.charCodeAt(state.pos) !== 0x7e) return false;
  const scanned = state.scanDelims(state.pos, true);
  const marker = scanned.length === 1 ? singleTilde : doubleTilde;
  const token = state.push('text', '', 0);
  token.content = '~'.repeat(scanned.length);
  if (scanned.length <= 2) {
    state.delimiters.push({
      marker,
      length: 0,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    });
  }
  state.pos += scanned.length;
  return true;
});
tokenizer.inline.ruler.enable('strikethrough');
tokenizer.inline.ruler2.at('strikethrough', (state: StateInline) => {
  function markPairs(delimiters: Delimiter[]) {
    for (const delimiter of delimiters) {
      if (![singleTilde, doubleTilde].includes(delimiter.marker) || delimiter.end < 0) continue;
      const open = state.tokens[delimiter.token]!;
      const close = state.tokens[delimiters[delimiter.end]!.token]!;
      open.type = 's_open';
      open.tag = 's';
      open.nesting = 1;
      open.content = '';
      close.type = 's_close';
      close.tag = 's';
      close.nesting = -1;
      close.content = '';
    }
  }
  markPairs(state.delimiters);
  for (const meta of state.tokens_meta) if (meta) markPairs(meta.delimiters);
  return true;
});
tokenizer.inline.ruler2.enable('strikethrough');

// Only the first paragraph of a list item may contain a task marker.
tokenizer.core.ruler.after('inline', 'task_items', (state) => {
  for (let i = 0; i < state.tokens.length - 2; i++) {
    const item = state.tokens[i]!;
    const paragraph = state.tokens[i + 1]!;
    const inline = state.tokens[i + 2]!;
    if (
      item.type !== 'list_item_open' ||
      paragraph.type !== 'paragraph_open' ||
      inline.type !== 'inline'
    )
      continue;
    const match = /^\[([ xX])\](?:[ \t\n]+|$)/.exec(inline.content);
    const first = inline.children?.[0];
    if (!match || first?.type !== 'text' || !/^\[[ xX]\]/.test(first.content)) continue;
    item.attrSet('data-task-checked', match[1]!.toLowerCase() === 'x' ? 'true' : 'false');
    first.content = first.content.slice(3).replace(/^[ \t]+/, '');
    if (!first.content) inline.children!.shift();
    if (inline.children?.[0]?.type === 'softbreak') inline.children.shift();
  }
  return true;
});

export const editorMarkdownParser = new MarkdownParser(editorSchema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  list_item: {
    block: 'list_item',
    getAttrs: (token) => ({
      checked:
        token.attrGet('data-task-checked') === null
          ? null
          : token.attrGet('data-task-checked') === 'true',
    }),
  },
  s: { mark: 'strike' },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: (token) => ({ align: token.attrGet('style') }) },
  td: { block: 'table_cell', getAttrs: (token) => ({ align: token.attrGet('style') }) },
});

export const editorMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    raw_inline(state, node) {
      state.write(node.attrs.raw);
    },
    raw_block(state, node) {
      state.write(node.attrs.raw);
      state.closeBlock(node);
    },
    table(state, node) {
      node.forEach((row, _offset, index) => {
        if (index > 0) state.write('\n');
        state.write('| ');
        row.forEach((cell, _cellOffset, cellIndex) => {
          if (cellIndex) state.write(' | ');
          // GFM splits table rows before parsing inline code, so a pipe must be
          // escaped even inside a code span (whose normal serializer deliberately
          // bypasses Markdown escaping). Escape only the temporary rendering node.
          const children: (typeof cell)[] = [];
          cell.forEach((child) => {
            const isCode = child.isText && child.marks.some((mark) => mark.type.name === 'code');
            children.push(
              isCode ? editorSchema.text(child.text!.replace(/\|/g, '\\|'), child.marks) : child,
            );
          });
          state.renderInline(cell.copy(Fragment.fromArray(children)));
        });
        state.write(' |');
        if (index === 0) {
          state.write('\n| ');
          row.forEach((cell, _cellOffset, cellIndex) => {
            if (cellIndex) state.write(' | ');
            const align = cell.attrs.align;
            state.write(
              align === 'text-align:left'
                ? ':---'
                : align === 'text-align:right'
                  ? '---:'
                  : align === 'text-align:center'
                    ? ':---:'
                    : '---',
            );
          });
          state.write(' |');
        }
      });
      state.closeBlock(node);
    },
    list_item(state, node) {
      if (node.attrs.checked !== null) state.write(node.attrs.checked ? '[x] ' : '[ ] ');
      state.renderContent(node);
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  },
  { escapeExtraCharacters: /\|/g },
);
