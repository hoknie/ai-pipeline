// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from 'prosemirror-view';
import { undo, undoDepth } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';

import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Field({ initial, changed }: { initial: string; changed: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownField
      aria-label="Description"
      value={value}
      onChange={(next) => {
        changed(next);
        setValue(next);
      }}
    />
  );
}

describe('MarkdownField', () => {
  it.each([
    ['ctrlKey', false],
    ['metaKey', false],
    ['ctrlKey', true],
    ['metaKey', true],
  ] as const)(
    'handles %s formatting and history only inside the editor (Cyrillic: %s)',
    (modifier, cyrillic) => {
      const shortcut = (key: string) => ({
        key: cyrillic ? ({ b: 'и', i: 'ш', k: 'л', z: 'я', Z: 'Я' }[key] ?? key) : key,
        code: `Key${key.toUpperCase()}`,
        [modifier]: true,
      });
      const updates = vi.spyOn(EditorView.prototype, 'updateState');
      const changed = vi.fn();
      render(
        <>
          <input aria-label="Outside" />
          <Field initial="Hello" changed={changed} />
        </>,
      );
      const editor = screen.getByRole('textbox', { name: 'Description' });
      editor.focus();
      fireEvent.paste(editor, {
        clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'x' : '') },
      });
      const view = updates.mock.instances[0] as EditorView;
      vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
      act(() =>
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6))),
      );
      for (const key of ['b', 'i', 'k']) {
        fireEvent.keyDown(editor, shortcut(key));
      }
      fireEvent.change(screen.getByRole('textbox', { name: 'Link destination' }), {
        target: { value: 'https://example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
      expect(view.state.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name)).toEqual(
        expect.arrayContaining(['strong', 'em', 'link']),
      );
      fireEvent.keyDown(editor, shortcut('z'));
      expect(
        view.state.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name),
      ).not.toContain('link');
      fireEvent.keyDown(editor, { ...shortcut('Z'), shiftKey: true });
      expect(view.state.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name)).toContain(
        'link',
      );
      const before = changed.mock.calls.length;
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Outside' }), shortcut('z'));
      expect(changed).toHaveBeenCalledTimes(before);
    },
  );
  it.each([
    ['bullet list', '- first\n- second', 'ul'],
    ['ordered list', '3. first\n4. second', 'ol'],
    ['quote', '> first\n>\n> second', 'blockquote'],
    ['table', '| first | second |\n| --- | --- |\n| third | fourth |', 'table'],
  ])('edits and undoes a CommonMark %s', (_name, original, tag) => {
    const updates = vi.spyOn(EditorView.prototype, 'updateState');
    const changed = vi.fn();
    render(<Field initial={original} changed={changed} />);
    const editor = screen.getByRole('textbox', { name: 'Description' });
    expect(editor.querySelector(tag)).not.toBeNull();
    editor.focus();
    fireEvent.paste(editor, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'added' : '') },
    });
    expect(changed.mock.lastCall?.[0]).toContain('addedfirst');
    expect(editor.textContent).toContain('addedfirst');
    expect(screen.getByRole('textbox', { name: 'Description' })).toBe(editor);
    const view = updates.mock.instances[0] as EditorView;
    expect(undoDepth(view.state)).toBe(1);
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    act(() => {
      expect(undo(view.state, view.dispatch)).toBe(true);
    });
    expect(changed.mock.lastCall?.[0]).not.toContain('addedfirst');
    expect(changed.mock.lastCall?.[0]).toContain('first');
    updates.mockRestore();
  });

  it('keeps unsupported nested content as raw fallback', () => {
    const changed = vi.fn();
    const fallback = '> ~~unsupported~~ ![image](image.png)';
    render(<Field initial={`Editable\n\n${fallback}`} changed={changed} />);
    const editors = screen.getAllByRole('textbox', { name: 'Description' });
    expect(editors).toHaveLength(1);
    editors[0]!.focus();
    fireEvent.paste(editors[0]!, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'new' : '') },
    });
    expect(changed.mock.lastCall?.[0]).toContain(fallback);
  });

  it('edits an imported strike selection, toggles it and undoes the change', () => {
    const updates = vi.spyOn(EditorView.prototype, 'updateState');
    const changed = vi.fn();
    render(<Field initial={'Hello ~~old~~ text\n\n<div>raw</div>'} changed={changed} />);
    const editor = screen.getByRole('textbox', { name: 'Description' });
    expect(editor.querySelector('del')?.textContent).toBe('old');
    expect(changed).not.toHaveBeenCalled();
    editor.focus();
    fireEvent.paste(editor, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'x' : '') },
    });
    const view = updates.mock.instances[0] as EditorView;
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    act(() => {
      undo(view.state, view.dispatch);
    });
    act(() =>
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 10))),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Strikethrough' }));
    expect(changed).toHaveBeenLastCalledWith('Hello old text\n\n<div>raw</div>');
    expect(editor.querySelector('del')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Strikethrough' }));
    expect(changed).toHaveBeenLastCalledWith('Hello ~~old~~ text\n\n<div>raw</div>');
    expect(editor.querySelector('del')?.textContent).toBe('old');
    act(() => {
      undo(view.state, view.dispatch);
    });
    expect(changed).toHaveBeenLastCalledWith('Hello old text\n\n<div>raw</div>');
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(
      (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value,
    ).toBe('Hello old text\n\n<div>raw</div>');
  });

  it('pastes strike as editable Markdown and retains it after source roundtrip', () => {
    const changed = vi.fn();
    render(<Field initial="Hello " changed={changed} />);
    const editor = screen.getByRole('textbox', { name: 'Description' });
    editor.focus();
    fireEvent.paste(editor, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? '~~gone~~' : '') },
    });
    expect(editor.querySelector('del')?.textContent).toBe('gone');
    expect(changed.mock.lastCall?.[0]).toContain('~~gone~~');
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(
      screen.getByRole('textbox', { name: 'Description' }).querySelector('del')?.textContent,
    ).toBe('gone');
  });

  it('imports single-tilde strike from source without rewriting it on a mode switch', () => {
    const changed = vi.fn();
    render(<Field initial="original" changed={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'before ~gone~ after' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(
      screen.getByRole('textbox', { name: 'Description' }).querySelector('del')?.textContent,
    ).toBe('gone');
    expect(changed).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(
      (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value,
    ).toBe('before ~gone~ after');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('preserves GFM and unfamiliar source exactly when switching modes without edits', () => {
    const original =
      '# Tasks\n\n- [x] ~~done~~\n- [ ] [next](https://example.com)\n\n' +
      '| left | right |\n| :--- | ---: |\n| a | b |\n\n' +
      '```json\n{ "key": true }\n```\n\n<div>unfamiliar</div>\n';
    const changed = vi.fn();
    render(<Field initial={original} changed={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(
      (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value,
    ).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(
      (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value,
    ).toBe(original);
    expect(changed).not.toHaveBeenCalled();
  });

  it('switches to source and back without rewriting unfamiliar fragments', () => {
    const original =
      'Text **bold**\n\n<div onclick="bad()">raw</div>\n\n| a | b |\n| - | - |\n| c | d |';
    const changed = vi.fn();
    render(<Field initial={original} changed={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(
      (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value,
    ).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps the source editable after a mode switch', () => {
    const changed = vi.fn();
    render(<Field initial="Hello" changed={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: '_Hello_' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(screen.getByText('Hello').tagName).toBe('EM');
    expect(changed).toHaveBeenLastCalledWith('_Hello_');
  });

  it('allows focusing locked source and ignores a formatted paste', () => {
    const changed = vi.fn();
    render(<MarkdownField aria-label="Description" value="locked" onChange={changed} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    const source = screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
    expect(source.readOnly).toBe(true);
    expect(document.activeElement).toBe(source);
    fireEvent.paste(source, { clipboardData: { getData: () => '<strong>unsafe edit</strong>' } });
    expect(source.value).toBe('locked');
    expect(changed).not.toHaveBeenCalled();
  });

  it('retains unsupported blocks when a different block is edited', () => {
    const changed = vi.fn();
    render(
      <Field
        initial={'Hello\n\n<div>raw</div>\n\n| a | b |\n| - | - |\n| c | d |'}
        changed={changed}
      />,
    );
    const editor = screen.getAllByRole('textbox', { name: 'Description' })[0]!;
    editor.focus();
    fireEvent.paste(editor, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'new' : '') },
    });
    expect(changed).toHaveBeenCalled();
    expect(changed.mock.lastCall?.[0]).toContain(
      '<div>raw</div>\n\n| a | b |\n| - | - |\n| c | d |',
    );
  });

  it('preserves adjacent unknown Markdown while editing a table cell', () => {
    const changed = vi.fn();
    const unknown = '~~~unfamiliar extra\nraw | content\n~~~';
    render(
      <Field initial={`${unknown}\n\n| a | b |\n| :--- | ---: |\n| c | d |`} changed={changed} />,
    );
    const editor = screen.getByRole('textbox', { name: 'Description' });
    editor.focus();
    fireEvent.paste(editor, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'new' : '') },
    });
    expect(changed.mock.lastCall?.[0]).toContain(unknown);
    expect(changed.mock.lastCall?.[0]).toContain('newa');
    expect(changed.mock.lastCall?.[0]).toContain('| :--- | ---: |');
  });

  it('keeps the focused editor when an empty document becomes nonempty', () => {
    const changed = vi.fn();
    const focus = vi.spyOn(EditorView.prototype, 'focus');
    try {
      render(<Field initial="" changed={changed} />);
      const editor = screen.getByRole('textbox', { name: 'Description' });
      editor.focus();
      fireEvent.paste(editor, {
        clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'new' : '') },
      });
      expect(changed).toHaveBeenLastCalledWith('new');
      expect(screen.getByRole('textbox', { name: 'Description' })).toBe(editor);
      expect(document.activeElement).toBe(editor);
      focus.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
      expect(focus).toHaveBeenCalledTimes(1);
    } finally {
      focus.mockRestore();
    }
  });
});
