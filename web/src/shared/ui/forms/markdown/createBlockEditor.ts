import type { RefObject } from 'react';
import { baseKeymap } from 'prosemirror-commands';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseEditorDocument } from '../../../lib/markdown/editorDocument.ts';
import { rawBlockView } from './rawBlockView.tsx';
import { sourceForTransaction } from '../../../lib/markdown/sourceHistory.ts';
import { editorKeyDown, listKeys } from './editorKeys.ts';
import { pasteHandlers } from './pasteHandlers.ts';
import { taskClick, taskNodeView } from './taskNodeView.ts';

export function createBlockEditor(
  host: HTMLElement,
  {
    raw,
    label,
    placeholder,
    id,
    disabled,
    last,
    change,
    active,
    taskLabel,
    link,
    diagramLabels,
  }: {
    raw: string;
    label: string;
    placeholder?: string;
    id?: string;
    disabled?: boolean;
    last: RefObject<string>;
    change: RefObject<(value: string) => void>;
    active: RefObject<(view: EditorView) => void>;
    taskLabel: RefObject<string>;
    link: RefObject<((view: EditorView) => void) | undefined>;
    diagramLabels: RefObject<{ loading: string; error: string; diagram: string }>;
  },
): EditorView {
  const paste = pasteHandlers(disabled, (editor) => active.current(editor));
  const doc = parseEditorDocument(raw);
  let firstText: number | undefined;
  doc.descendants((node, pos) => {
    if (node.isTextblock && firstText === undefined) firstText = pos + 1;
    return firstText === undefined;
  });
  const editor = new EditorView(host, {
    state: EditorState.create({
      doc,
      selection: firstText === undefined ? undefined : TextSelection.create(doc, firstText),
      plugins: [history(), keymap(listKeys), keymap(baseKeymap)],
    }),
    editable: () => !disabled,
    nodeViews: {
      list_item: (node) => taskNodeView(node, disabled, taskLabel),
      raw_block: (node) => rawBlockView(node, diagramLabels.current),
    },
    attributes: {
      role: 'textbox',
      tabindex: '0',
      'aria-label': label,
      ...(placeholder ? { 'aria-placeholder': placeholder } : {}),
      'aria-multiline': 'true',
      ...(id ? { id } : {}),
      ...(disabled ? { 'aria-disabled': 'true' } : {}),
    },
    ...paste,
    handleDOMEvents: {
      ...paste.handleDOMEvents,
      click: (view, event) => taskClick(view, event, disabled),
    },
    handleKeyDown: (view, event) => editorKeyDown(view, event, disabled, link.current),
    dispatchTransaction(transaction) {
      const nextSource = transaction.docChanged
        ? sourceForTransaction(last.current, editor.state.doc, transaction)
        : last.current;
      const state = editor.state.apply(transaction);
      editor.updateState(state);
      if (transaction.docChanged) {
        last.current = nextSource;
        change.current(last.current);
      }
    },
  });
  return editor;
}
