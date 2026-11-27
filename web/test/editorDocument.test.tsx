import { expect, it } from 'vitest';
import { parseEditorDocument } from '../src/shared/lib/markdown/editorDocument.ts';
import { preserveEditorBlocks } from '../src/shared/lib/markdown/preserveEditorBlocks.ts';

it('keeps unsupported blocks and exact separators beside an edited table', () => {
  const source =
    '\r\n_first_\r\n\r\n\r\n<div>unknown</div>\r\n\r\n| A | B |\r\n| --- | --- |\r\n| C | D |\r\n';
  const before = parseEditorDocument(source);
  expect(before.childCount).toBe(3);
  expect(before.child(1).type.name).toBe('raw_block');
  const after = parseEditorDocument(source.replace('| C |', '| changed |'));
  const result = preserveEditorBlocks(source, before, after);
  expect(result.slice(0, result.indexOf('| A'))).toBe(source.slice(0, source.indexOf('| A')));
  expect(result).toContain('| changed | D |');
  expect(result.endsWith('\r\n')).toBe(true);
});

it('keeps unsupported inline HTML as atoms inside an editable paragraph', () => {
  const source = 'before <custom>unknown</custom> after\n\n_other_';
  const before = parseEditorDocument(source);
  expect(before.firstChild?.type.name).toBe('paragraph');
  expect(before.firstChild?.child(1).type.name).toBe('raw_inline');
  const after = parseEditorDocument(source.replace('_other_', '**edited**'));
  expect(preserveEditorBlocks(source, before, after)).toBe(
    'before <custom>unknown</custom> after\n\n**edited**',
  );
});
