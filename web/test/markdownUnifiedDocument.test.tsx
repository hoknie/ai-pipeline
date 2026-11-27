// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { closeHistory, redo, undo } from 'prosemirror-history';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('uses one selection and history for paragraphs, lists and tables', () => {
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  function Field() {
    const [value, setValue] = useState('First\n\n- item\n\n| A | B |\n| --- | --- |\n| C | D |');
    return <MarkdownField aria-label="Body" value={value} onChange={setValue} />;
  }
  render(<Field />);
  const editor = screen.getByRole('textbox', { name: 'Body' });
  expect(editor.querySelector('ul')).not.toBeNull();
  expect(editor.querySelector('table')).not.toBeNull();
  editor.focus();
  fireEvent.paste(editor, { clipboardData: { getData: () => 'x' } });
  const view = updates.mock.instances[0] as EditorView;
  vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  const before = view.state.doc.textContent;
  act(() =>
    view.dispatch(
      closeHistory(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 3))
          .insertText('changed'),
      ),
    ),
  );
  expect(view.state.doc.textContent).toContain('changed');
  act(() => {
    expect(undo(view.state, view.dispatch)).toBe(true);
  });
  expect(view.state.doc.textContent).toBe(before);
  act(() => {
    expect(redo(view.state, view.dispatch)).toBe(true);
  });
  expect(view.state.doc.textContent).toContain('changed');
  updates.mockRestore();
});

it('keeps a single view and history with raw blocks and unusual whitespace', () => {
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  const source =
    '\r\n_first_\r\n\r\n\r\n<div>unknown</div>\r\n\r\n| A | B |\r\n| --- | --- |\r\n| C | D |\r\n';
  let latest = source;
  function Field() {
    const [value, setValue] = useState(source);
    return (
      <MarkdownField
        aria-label="Mixed"
        value={value}
        onChange={(next) => {
          latest = next;
          setValue(next);
        }}
      />
    );
  }
  const { container } = render(<Field />);
  expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1);
  expect(container.querySelector('[data-raw-markdown]')?.textContent).toBe('<div>unknown</div>');
  const editor = screen.getByRole('textbox', { name: 'Mixed' });
  editor.focus();
  fireEvent.paste(editor, { clipboardData: { getData: () => 'x' } });
  const view = updates.mock.instances[0] as EditorView;
  vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  const before = view.state.doc;
  act(() =>
    view.dispatch(
      closeHistory(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 3))
          .insertText('changed'),
      ),
    ),
  );
  expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1);
  act(() => {
    expect(undo(view.state, view.dispatch)).toBe(true);
  });
  expect(view.state.doc.eq(before)).toBe(true);
  expect(latest).toContain('<div>unknown</div>');
  act(() => {
    expect(redo(view.state, view.dispatch)).toBe(true);
  });
  expect(view.state.doc.textContent).toContain('changed');
  expect(updates.mock.instances.every((instance) => instance === view)).toBe(true);
});

it('pastes an unknown fenced block into the same history and restores exact source on undo', () => {
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  const original = '_first_\r\n\r\n\r\n_last_\r\n';
  let latest = original;
  function Field() {
    const [value, setValue] = useState(original);
    return (
      <MarkdownField
        aria-label="Paste"
        value={value}
        onChange={(next) => {
          latest = next;
          setValue(next);
        }}
      />
    );
  }
  const { container } = render(<Field />);
  const editor = screen.getByRole('textbox', { name: 'Paste' });
  editor.focus();
  const unknown = '~~~unknown extra\n<img src=x onerror=alert(1)>\n~~~';
  fireEvent.paste(editor, {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? unknown : '') },
  });
  const view = updates.mock.instances[0] as EditorView;
  vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('[data-raw-markdown]')).not.toBeNull();
  expect(latest).toContain(unknown);
  const pasted = latest;
  act(() => {
    expect(undo(view.state, view.dispatch)).toBe(true);
  });
  expect(latest).toBe(original);
  act(() => {
    expect(redo(view.state, view.dispatch)).toBe(true);
  });
  expect(latest).toBe(pasted);
  expect(updates.mock.instances.every((instance) => instance === view)).toBe(true);
});
