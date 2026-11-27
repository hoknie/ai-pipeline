// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from './render.tsx';
import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(original: string) {
  let latest = original;
  let replace: (value: string) => void = () => {};
  const updates = vi.spyOn(EditorView.prototype, 'updateState');
  vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  });
  function Field() {
    const [value, setValue] = useState(original);
    replace = setValue;
    return (
      <MarkdownField
        aria-label="Body"
        value={value}
        onChange={(next) => {
          latest = next;
          setValue(next);
        }}
      />
    );
  }
  render(<Field />);
  const editor = screen.getByRole('textbox', { name: 'Body' });
  editor.focus();
  fireEvent.paste(editor, {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'x' : '') },
  });
  const view = updates.mock.instances[0] as EditorView;
  act(() => {
    undo(view.state, view.dispatch);
  });
  return {
    editor,
    view,
    replace: (value: string) => act(() => replace(value)),
    get latest() {
      return latest;
    },
  };
}

it.each([
  ['ctrlKey', 'k', ''],
  ['metaKey', 'k', ''],
  ['ctrlKey', 'л', 'KeyK'],
  ['metaKey', 'л', 'KeyK'],
] as const)(
  'edits link text and destination with %s+K (%s) and undoes once',
  (modifier, key, code) => {
    const original = 'Read [old](https://old.example) now\r\n';
    const field = setup(original);
    act(() =>
      field.view.dispatch(
        field.view.state.tr.setSelection(TextSelection.create(field.view.state.doc, 7)),
      ),
    );
    fireEvent.keyDown(field.editor, { key, code, [modifier]: true });
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Link text' }).value).toBe('old');
    fireEvent.change(screen.getByRole('textbox', { name: 'Link text' }), {
      target: { value: 'new label' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Link destination' }), {
      target: { value: 'https://new.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
    expect(field.latest).toBe('Read [new label](https://new.example) now\r\n');
    expect(document.activeElement).toBe(field.editor);
    fireEvent.keyDown(field.editor, { key: 'z', [modifier]: true });
    expect(field.latest).toBe(original);
    fireEvent.keyDown(field.editor, { key: 'Z', shiftKey: true, [modifier]: true });
    expect(field.latest).toContain('[new label](https://new.example)');
  },
);

it('inserts a new link from the toolbar and rejects unsafe schemes without changing the draft', () => {
  const field = setup('word');
  act(() =>
    field.view.dispatch(
      field.view.state.tr.setSelection(TextSelection.create(field.view.state.doc, 1, 5)),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Link' }));
  const destination = screen.getByRole('textbox', { name: 'Link destination' });
  fireEvent.change(destination, { target: { value: 'javascript:alert(1)' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(field.latest).toBe('word');
  fireEvent.change(destination, { target: { value: 'https://example.com' } });
  fireEvent.keyDown(destination, { key: 'Enter' });
  expect(field.latest).toBe('[word](https://example.com)');
});

it('renders, edits and undoes a relative link destination', () => {
  const original = '[guide](docs/guide.md)';
  const field = setup(original);
  expect(field.editor.querySelector('a')?.getAttribute('href')).toBe('docs/guide.md');
  act(() =>
    field.view.dispatch(
      field.view.state.tr.setSelection(TextSelection.create(field.view.state.doc, 2)),
    ),
  );
  fireEvent.keyDown(field.editor, { key: 'k', ctrlKey: true });
  fireEvent.change(screen.getByRole('textbox', { name: 'Link destination' }), {
    target: { value: '../new/guide.md#usage' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
  expect(field.latest).toBe('[guide](../new/guide.md#usage)');
  fireEvent.keyDown(field.editor, { key: 'z', ctrlKey: true });
  expect(field.latest).toBe(original);
});

it('closes a stale link editor when an external value replaces the document', () => {
  const field = setup('A long description followed by [guide](docs/guide.md)');
  act(() =>
    field.view.dispatch(
      field.view.state.tr.setSelection(TextSelection.create(field.view.state.doc, 34)),
    ),
  );
  fireEvent.keyDown(field.editor, { key: 'k', ctrlKey: true });
  expect(screen.getByRole('dialog')).toBeTruthy();
  field.replace('short');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(field.editor.textContent).toBe('short');
  expect(field.editor.querySelector('a')).toBeNull();
  expect(field.latest).toBe('A long description followed by [guide](docs/guide.md)');
});

it('removes only the selected link, and cancellation leaves the draft alone', () => {
  const original = '[one](https://same.example) and [two](https://same.example)';
  const field = setup(original);
  act(() =>
    field.view.dispatch(
      field.view.state.tr.setSelection(TextSelection.create(field.view.state.doc, 2)),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Link' }));
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Link text' }).value).toBe('one');
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Link destination' }), { key: 'Escape' });
  expect(field.latest).toBe(original);
  fireEvent.click(screen.getByRole('button', { name: 'Link' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
  expect(field.latest).toBe('one and [two](https://same.example)');
  act(() => {
    undo(field.view.state, field.view.dispatch);
  });
  expect(field.latest).toBe(original);
});
