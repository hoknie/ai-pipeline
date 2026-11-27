import { closeHistory } from 'prosemirror-history';
import type { EditorState, Transaction } from 'prosemirror-state';

/** Relative destinations are allowed; explicit schemes must be inert web/mail links. */
export function isSafeLink(href: string): boolean {
  const value = href.trim();
  // eslint-disable-next-line no-control-regex
  if (!value || /[\u0000-\u001f\u007f]/.test(href)) return false;
  const scheme = /^([^/?#]*):/.exec(value)?.[1];
  return scheme === undefined || /^(https?|mailto)$/i.test(scheme);
}

export type LinkDraft = {
  from: number;
  to: number;
  text: string;
  href: string;
  title: string | null;
};

export function selectedLink(state: EditorState): LinkDraft {
  let { from, to } = state.selection;
  const $from = state.doc.resolve(from);
  const link = state.schema.marks.link!;
  const mark =
    link.isInSet($from.nodeAfter?.marks ?? []) ?? link.isInSet($from.nodeBefore?.marks ?? []);
  if (mark && $from.sameParent(state.doc.resolve(to))) {
    const ranges: { from: number; to: number }[] = [];
    $from.parent.forEach((node, offset) => {
      if (mark.isInSet(node.marks)) {
        const last = ranges.at(-1);
        if (last?.to === offset) last.to = offset + node.nodeSize;
        else ranges.push({ from: offset, to: offset + node.nodeSize });
      }
    });
    const range = ranges.find(
      (range) => range.from <= $from.parentOffset && range.to >= $from.parentOffset,
    );
    if (range) {
      from = $from.start() + range.from;
      to = $from.start() + range.to;
    }
  }
  return {
    from,
    to,
    text: state.doc.textBetween(from, to, '\n'),
    href: mark?.attrs.href ?? 'https://',
    title: mark?.attrs.title ?? null,
  };
}

export function linkTransaction(
  state: EditorState,
  draft: LinkDraft,
  remove = false,
): Transaction | null {
  if (draft.from < 0 || draft.to > state.doc.content.size || draft.from > draft.to) return null;
  if (!remove && (!draft.text || !isSafeLink(draft.href))) return null;
  const tr = closeHistory(state.tr);
  const link = state.schema.marks.link!;
  if (remove) return tr.removeMark(draft.from, draft.to, link);
  let to = draft.to;
  if (state.doc.textBetween(draft.from, draft.to, '\n') !== draft.text) {
    tr.insertText(draft.text, draft.from, draft.to);
    to = draft.from + draft.text.length;
  }
  return tr
    .removeMark(draft.from, to, link)
    .addMark(draft.from, to, link.create({ href: draft.href.trim(), title: draft.title }));
}
