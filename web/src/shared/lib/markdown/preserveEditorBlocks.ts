import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { editEditorSource, parseEditorSource } from './editorSource.ts';
import { editorMarkdownSerializer, editorSchema } from './editorSchema.ts';
import { parseDocumentBlock } from './editorDocument.ts';
import { preserveTextRange } from './preserveTextRange.ts';

function matchesSource(mapped: ProseMirrorNode, previous: ProseMirrorNode): boolean {
  if (mapped.eq(previous)) return true;
  // A toolbar-created code block stays editable in the current EditorState.
  // Reopening its fenced source uses an atom, but that is not a source mismatch.
  if (
    mapped.type.name === 'raw_block' &&
    previous.type.name === 'code_block' &&
    mapped.attrs.code === previous.textContent &&
    (mapped.attrs.language ?? '') === (previous.attrs.params ?? '')
  )
    return true;
  if (mapped.isLeaf || previous.isLeaf) return false;
  if (!mapped.sameMarkup(previous) || mapped.childCount !== previous.childCount) return false;
  for (let index = 0; index < mapped.childCount; index++)
    if (!matchesSource(mapped.child(index), previous.child(index))) return false;
  return true;
}

function preserveResized(
  markdown: string,
  blocks: readonly { from: number; to: number }[],
  previous: ProseMirrorNode,
  next: ProseMirrorNode,
): string {
  let prefix = 0;
  while (
    prefix < previous.childCount &&
    prefix < next.childCount &&
    previous.child(prefix).eq(next.child(prefix))
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < previous.childCount - prefix &&
    suffix < next.childCount - prefix &&
    previous.child(previous.childCount - 1 - suffix).eq(next.child(next.childCount - 1 - suffix))
  )
    suffix++;
  const inserted: ProseMirrorNode[] = [];
  for (let i = prefix; i < next.childCount - suffix; i++) inserted.push(next.child(i));
  const replacement = inserted.length
    ? editorMarkdownSerializer.serialize(editorSchema.node('doc', null, inserted))
    : '';
  const oldEnd = previous.childCount - suffix;
  if (prefix === oldEnd) {
    if (!replacement) return markdown;
    if (prefix < blocks.length) {
      const at = blocks[prefix]!.from;
      return markdown.slice(0, at) + replacement + '\n\n' + markdown.slice(at);
    }
    const at = blocks.length ? blocks[blocks.length - 1]!.to : 0;
    return markdown.slice(0, at) + (at ? '\n\n' : '') + replacement + markdown.slice(at);
  }
  const from = blocks[prefix]!.from;
  const to = blocks[oldEnd - 1]!.to;
  return markdown.slice(0, from) + replacement + markdown.slice(to);
}

/** Keep exact source and separators for unchanged top-level nodes where mapping is unambiguous. */
export function preserveEditorBlocks(
  markdown: string,
  previous: ProseMirrorNode,
  next: ProseMirrorNode,
): string {
  const parsed = parseEditorSource(markdown);
  if (!parsed.ok || parsed.source.blocks.length !== previous.childCount)
    return editorMarkdownSerializer.serialize(next);
  const replacements = new Map<number, string>();
  for (let index = 0; index < previous.childCount; index++) {
    const original = parsed.source.blocks[index]!;
    const mapped = parseDocumentBlock(original);
    if (!matchesSource(mapped, previous.child(index))) {
      return editorMarkdownSerializer.serialize(next);
    }
    if (previous.childCount !== next.childCount) continue;
    const current = next.child(index);
    if (!current.eq(previous.child(index))) {
      replacements.set(
        index,
        preserveTextRange(original, previous.child(index), current) ??
          editorMarkdownSerializer.serialize(editorSchema.node('doc', null, [current])),
      );
    }
  }
  return previous.childCount === next.childCount
    ? editEditorSource(parsed.source, replacements)
    : preserveResized(markdown, parsed.source.blocks, previous, next);
}
