import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { EditorSourceBlock } from './editorSource.ts';
import { parseEditorSource } from './editorSource.ts';
import { editorSchema } from './editorSchema.ts';
import { mdastBlock } from './mdastDocument.ts';

/** Unsupported blocks belong to the same document and history, but retain literal source. */
export function parseDocumentBlock(block: EditorSourceBlock): ProseMirrorNode {
  const raw = () =>
    editorSchema.node('raw_block', {
      raw: block.raw,
      code: block.node.type === 'code' ? block.node.value : null,
      language: block.node.type === 'code' ? block.node.lang : null,
    });
  try {
    return mdastBlock(block.node, { markdown: block.raw, offset: block.from });
  } catch {
    return raw();
  }
}

export function parseEditorDocument(markdown: string): ProseMirrorNode {
  const parsed = parseEditorSource(markdown);
  if (!parsed.ok)
    return editorSchema.node('doc', null, [editorSchema.node('raw_block', { raw: markdown })]);
  const nodes = parsed.source.blocks.map(parseDocumentBlock);
  return editorSchema.node('doc', null, nodes.length ? nodes : [editorSchema.node('paragraph')]);
}
