import { describe, expect, it } from 'vitest';
import {
  editorMarkdownParser,
  editorMarkdownSerializer,
} from '../src/shared/lib/markdown/editorSchema.ts';

describe('GFM table model', () => {
  it('parses editable cells and retains alignment when serialized', () => {
    const doc = editorMarkdownParser.parse('| A | B |\n| :--- | ---: |\n| one | two |');
    const table = doc!.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.child(0).child(0).type.name).toBe('table_header');
    expect(table.child(1).child(1).textContent).toBe('two');
    const result = editorMarkdownSerializer.serialize(doc!);
    expect(result).toContain('| :--- | ---: |');
    expect(editorMarkdownParser.parse(result)!.firstChild!.child(1).child(1).textContent).toBe(
      'two',
    );
  });

  it('preserves escaped pipes in ordinary cells', () => {
    const doc = editorMarkdownParser.parse('| A | B |\n| --- | --- |\n| x\\|y | z |')!;
    const result = editorMarkdownParser.parse(editorMarkdownSerializer.serialize(doc))!;
    expect(result.firstChild!.child(1).child(0).textContent).toBe('x|y');
    expect(result.firstChild!.child(1).childCount).toBe(2);
  });

  it.each([
    ['`x\\|y`', 'x|y'],
    ['`` x`\\|y ``', 'x`|y'],
    ['``` x``\\|y ```', 'x``|y'],
    ['`x\\\\|y`', 'x\\|y'],
  ])('round-trips inline code %s inside a table', (code, expected) => {
    const doc = editorMarkdownParser.parse(`| A | B |\n| :--- | ---: |\n| ${code} | z |`)!;
    expect(doc.firstChild!.child(1).child(0).textContent).toBe(expected);
    const markdown = editorMarkdownSerializer.serialize(doc);
    const restored = editorMarkdownParser.parse(markdown)!;
    expect(restored.firstChild!.child(1).childCount).toBe(2);
    expect(restored.firstChild!.child(1).child(0).textContent).toBe(expected);
    expect(restored.firstChild!.child(1).child(0).firstChild!.marks[0]!.type.name).toBe('code');
    expect(markdown).toContain('| :--- | ---: |');
  });
});
