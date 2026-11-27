import type { EditorProps, EditorView } from 'prosemirror-view';
import { parseEditorDocument } from '../../../lib/markdown/editorDocument.ts';
import { Fragment, Slice } from 'prosemirror-model';
import { isSafeLink } from '../../../lib/markdown/linkEditing.ts';
import { closeHistory } from 'prosemirror-history';
import { safePastedHtml } from './safePaste.ts';
import { shortcutKey } from './editorKeys.ts';

export function pasteHandlers(
  disabled: boolean | undefined,
  active: (view: EditorView) => void,
): Pick<EditorProps, 'handleDOMEvents' | 'handlePaste'> {
  let pasteAsPlain = false;
  return {
    handleDOMEvents: {
      focus: (editor) => {
        active(editor);
        return false;
      },
      keydown: (_editor, event) => {
        if (
          shortcutKey(event) === 'v' &&
          !event.altKey &&
          event.shiftKey &&
          (event.ctrlKey || event.metaKey)
        )
          pasteAsPlain = true;
        return false;
      },
      keyup: (_editor, event) => {
        if (shortcutKey(event) === 'v') pasteAsPlain = false;
        return false;
      },
    },
    handlePaste: (editor, event) => {
      if (disabled) return true;
      const html = event.clipboardData?.getData('text/html') ?? '';
      const plain = event.clipboardData?.getData('text/plain') ?? '';
      if (pasteAsPlain || editor.state.selection.$from.parent.type.spec.code) {
        pasteAsPlain = false;
        if (plain) editor.dispatch(closeHistory(editor.state.tr).insertText(plain));
        return true;
      }
      const text = (html && safePastedHtml(html)) || plain;
      if (!text) return true;
      if (!text.trim()) {
        editor.dispatch(closeHistory(editor.state.tr).insertText(text));
        return true;
      }
      const inlineText = !/[\r\n]/.test(text);
      // Parse indentation before deciding whether this is inline content: four
      // spaces (or a tab) can turn even a single line into a literal code block.
      const doc = parseEditorDocument(text);
      if (!doc) return true;
      let safe = true;
      doc.descendants((node) => {
        if (node.type.name === 'image') safe = false;
        for (const mark of node.marks) {
          if (mark.type.name === 'link' && !isSafeLink(mark.attrs.href)) safe = false;
        }
      });
      if (!safe) {
        editor.dispatch(closeHistory(editor.state.tr).insertText(plain || text));
        return true;
      }
      let content =
        doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph'
          ? new Slice(doc.firstChild.content, 0, 0)
          : doc.slice(0, doc.content.size);
      if (inlineText && doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph') {
        const lead = /^[ \t]+/.exec(text)?.[0] ?? '';
        const trail = /[ \t]+$/.exec(text)?.[0] ?? '';
        const { schema } = editor.state;
        const prefix = lead ? Fragment.from(schema.text(lead)) : Fragment.empty;
        const suffix = trail ? Fragment.from(schema.text(trail)) : Fragment.empty;
        content = new Slice(prefix.append(content.content).append(suffix), 0, 0);
      }
      editor.dispatch(closeHistory(editor.state.tr).replaceSelection(content));
      return true;
    },
  };
}
