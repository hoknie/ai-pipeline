import { expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { closeHistory, history, redo, undo } from 'prosemirror-history';
import { parseEditorDocument } from '../src/shared/lib/markdown/editorDocument.ts';
import {
  MarkdownSourceStep,
  sourceForTransaction,
} from '../src/shared/lib/markdown/sourceHistory.ts';

function editor(initial: string) {
  let source = initial;
  let state = EditorState.create({ doc: parseEditorDocument(initial), plugins: [history()] });
  function dispatch(transaction: Transaction) {
    if (transaction.docChanged) source = sourceForTransaction(source, state.doc, transaction);
    state = state.apply(transaction);
  }
  return {
    get source() {
      return source;
    },
    get state() {
      return state;
    },
    dispatch,
  };
}

it('restores exact Markdown bytes rather than reserializing the model on undo', () => {
  const original = '\r\n_first_\r\n\r\n\r\n~~~odd extra\r\nunknown\r\n~~~\r\n\r\n_last_\r\n';
  const view = editor(original);
  view.dispatch(view.state.tr.insertText('edited', 1, 6));
  const edited = view.source;
  expect(edited).not.toBe(original);
  expect(edited).toContain('~~~odd extra\r\nunknown\r\n~~~');
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(original);
  expect(redo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(edited);
});

it('restores grouped edits and discards the redo branch after a new edit', () => {
  const original = '_a_\n\n\n_b_\n';
  const view = editor(original);
  view.dispatch(view.state.tr.insertText('1', 2));
  view.dispatch(view.state.tr.insertText('2', 3));
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(original);
  view.dispatch(view.state.tr.insertText('new', 2));
  expect(redo(view.state, view.dispatch)).toBe(false);
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(original);
});

it('keeps source patches aligned through cross-block deletion and multiple history events', () => {
  const original = '_one_\r\n\r\n<div>raw</div>\r\n\r\n_two_\r\n';
  const view = editor(original);
  view.dispatch(
    closeHistory(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1))
        .insertText('replacement'),
    ),
  );
  const first = view.source;
  view.dispatch(closeHistory(view.state.tr.insertText('!', 2)));
  const second = view.source;
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(first);
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(original);
  expect(redo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(first);
  expect(redo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(second);
});

it('serializes invertible source patches and rejects malformed data', () => {
  const patch = new MarkdownSourceStep(1, 'old', 'new');
  const restored = MarkdownSourceStep.fromJSON(null, patch.toJSON());
  expect(restored.patch(' old ')).toBe(' new ');
  expect(restored.invert().patch(' new ')).toBe(' old ');
  expect(restored.patch(' different ')).toBeNull();
  expect(() =>
    MarkdownSourceStep.fromJSON(null, { from: -1, removed: '', inserted: '' }),
  ).toThrow();
});

it('edits known text inside a paragraph containing raw inline syntax without losing it', () => {
  const original = 'before <custom data-x="value">unknown</custom> ![image](local.png) after\r\n';
  const view = editor(original);
  expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  view.dispatch(view.state.tr.insertText('changed', 1, 7));
  expect(view.source).toBe(original.replace('before', 'changed'));
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(original);
  expect(redo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(original.replace('before', 'changed'));
});

it('does not normalize unknown literal extensions or existing emphasis around a text edit', () => {
  const original = '_before_ [[custom extension]] after\r\n';
  const view = editor(original);
  view.dispatch(view.state.tr.insertText('changed', 1, 7));
  expect(view.source).toBe('_changed_ [[custom extension]] after\r\n');
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.source).toBe(original);
});
