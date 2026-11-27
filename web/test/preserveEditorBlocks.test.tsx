import { expect, it } from 'vitest';
import { editorMarkdownParser } from '../src/shared/lib/markdown/editorSchema.ts';
import { preserveEditorBlocks } from '../src/shared/lib/markdown/preserveEditorBlocks.ts';

it('retains untouched spelling and separators when one block changes', () => {
  const original = '_first_\r\n\r\n\r\n- item\r\n\r\n| A | B |\r\n| :- | -: |\r\n| x | y |\r\n';
  const before = editorMarkdownParser.parse(original)!;
  const after = editorMarkdownParser.parse(
    '_first_\n\n- changed\n\n| A | B |\n| :- | -: |\n| x | y |',
  )!;
  expect(preserveEditorBlocks(original, before, after)).toBe(
    original.replace('- item', '- changed'),
  );
});

it('inserts a new block without normalizing an existing block', () => {
  const before = editorMarkdownParser.parse('one')!;
  const after = editorMarkdownParser.parse('one\n\ntwo')!;
  expect(preserveEditorBlocks('one', before, after)).toBe('one\n\ntwo');
});

it.each(['```ts\nconst x = 1\n```', '> ```ts\n> const x = 1\n> ```'])(
  'retains surrounding bytes after editing alongside a toolbar-created code block: %s',
  (code) => {
    const original = `_first_\r\n\r\n\r\n${code}\r\n\r\n_last_\r\n`;
    const before = editorMarkdownParser.parse(original)!;
    const after = editorMarkdownParser.parse(original.replace('_first_', '_changed_'))!;
    expect(preserveEditorBlocks(original, before, after)).toBe(
      original.replace('_first_', '_changed_'),
    );
  },
);

it('keeps exact surrounding blocks and CRLF separators after insert and delete', () => {
  const original = '_first_\r\n\r\n\r\n**last**\r\n';
  const before = editorMarkdownParser.parse(original)!;
  const inserted = editorMarkdownParser.parse('_first_\n\nnew\n\n**last**')!;
  const result = preserveEditorBlocks(original, before, inserted);
  expect(result).toBe('_first_\r\n\r\n\r\nnew\n\n**last**\r\n');
  const restored = preserveEditorBlocks(result, inserted, before);
  expect(restored).toContain('_first_\r\n\r\n\r\n');
  expect(restored).toContain('**last**\r\n');
  expect(editorMarkdownParser.parse(restored)!.eq(before)).toBe(true);
});
