import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent } from 'mdast';

/** A top-level GFM node and its exact, original UTF-16 source range. */
export type EditorSourceBlock = {
  readonly node: RootContent;
  readonly from: number;
  readonly to: number;
  readonly raw: string;
};

export type EditorSource = {
  readonly markdown: string;
  readonly blocks: readonly EditorSourceBlock[];
};

export type EditorSourceResult =
  | { readonly ok: true; readonly source: EditorSource }
  | { readonly ok: false; readonly markdown: string; readonly error: unknown };

const parser = unified().use(remarkParse).use(remarkGfm);

/** Parse without rendering HTML. On failure the caller still has the untouched source. */
export function parseEditorSource(markdown: string): EditorSourceResult {
  try {
    const tree = parser.parse(markdown);
    let end = 0;
    const blocks = tree.children.map((node): EditorSourceBlock => {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (
        from === undefined ||
        to === undefined ||
        from < end ||
        to < from ||
        to > markdown.length
      ) {
        throw new Error('Invalid Markdown source positions');
      }
      end = to;
      return { node, from, to, raw: markdown.slice(from, to) };
    });
    return { ok: true, source: { markdown, blocks } };
  } catch (error) {
    return { ok: false, markdown, error };
  }
}

/**
 * Replace explicitly edited top-level blocks; everything else, including whitespace between
 * blocks and raw HTML, is copied exactly from the original string. Reparse the result
 * before applying further edits: block indices and offsets belong to this snapshot only.
 */
export function editEditorSource(
  source: EditorSource,
  replacements: ReadonlyMap<number, string>,
): string {
  for (const index of replacements.keys()) {
    if (!Number.isInteger(index) || index < 0 || index >= source.blocks.length) {
      throw new RangeError('Invalid Markdown block index');
    }
  }
  let out = '';
  let end = 0;
  source.blocks.forEach((block, index) => {
    out += source.markdown.slice(end, block.from);
    out += replacements.get(index) ?? block.raw;
    end = block.to;
  });
  return out + source.markdown.slice(end);
}
