import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {
  editorMarkdownParser,
  editorMarkdownSerializer,
} from '../src/shared/lib/markdown/editorSchema.ts';

describe('strike Markdown bridge', () => {
  it.each([
    '~one~',
    '~~one~~',
    '~one~~',
    '~~one~',
    'a~b~c',
    '~~a~b~~',
    '~a~~b~',
    '~~a **b** c~~',
    '~~a~~ and ~b~',
    '\\~a~',
    '~~~a~~~',
  ])('agrees with the GFM parser about strike boundaries in %s', (source) => {
    const expected: string[] = [];
    const actual: string[] = [];
    const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
    function collect(node: { type: string; value?: string; children?: unknown[] }, strike = false) {
      if (node.type === 'text') {
        for (const character of node.value ?? '') expected.push(`${strike}:${character}`);
      }
      for (const child of node.children ?? [])
        collect(child as typeof node, strike || node.type === 'delete');
    }
    collect(tree);
    editorMarkdownParser.parse(source).descendants((node) => {
      if (node.isText)
        for (const character of node.text ?? '')
          actual.push(`${node.marks.some((mark) => mark.type.name === 'strike')}:${character}`);
    });
    expect(actual).toEqual(expected);
  });
  it.each([
    '~~gone~~',
    '~gone~',
    '**~~gone~~**',
    '[~~gone~~](https://example.com)',
    'before ~~one *two*~~ after',
  ])('preserves strike semantics on serialization: %s', (source) => {
    const doc = editorMarkdownParser.parse(source);
    let marked = false;
    doc.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === 'strike')) marked = true;
    });
    expect(marked).toBe(true);
    expect(editorMarkdownParser.parse(editorMarkdownSerializer.serialize(doc)).eq(doc)).toBe(true);
  });

  it.each(['~one~~', '~~one~', '\\~not strike\\~', '`~~code~~`', '~~~literal~~~'])(
    'does not add a strike mark to %s',
    (source) => {
      const doc = editorMarkdownParser.parse(source);
      doc.descendants((node) =>
        expect(node.marks.some((mark) => mark.type.name === 'strike')).toBe(false),
      );
      expect(editorMarkdownParser.parse(editorMarkdownSerializer.serialize(doc)).eq(doc)).toBe(
        true,
      );
    },
  );
});
