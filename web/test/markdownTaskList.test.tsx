// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from 'prosemirror-view';
import { undo } from 'prosemirror-history';
import i18next from 'i18next';
import {
  editorMarkdownParser,
  editorMarkdownSerializer,
} from '../src/shared/lib/markdown/editorSchema.ts';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Field({
  initial,
  changed,
  disabled = false,
}: {
  initial: string;
  changed: (value: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownField
      aria-label="Description"
      value={value}
      disabled={disabled}
      onChange={(next) => {
        changed(next);
        setValue(next);
      }}
    />
  );
}

describe('GFM task lists', () => {
  it.each([
    '- [ ] todo\n- [x] ~~done~~\n- regular',
    '1. [X] done\n2. [ ] **todo**',
    '- [ ] parent\n  - [x] child\n- ordinary',
    '- [x] first\n\n  second paragraph',
  ])('roundtrips task state and list content: %s', (source) => {
    const doc = editorMarkdownParser.parse(source);
    const serialized = editorMarkdownSerializer.serialize(doc);
    expect(editorMarkdownParser.parse(serialized).eq(doc)).toBe(true);
    expect(serialized).toContain('[x]');
  });

  it.each(['- [x]no', '- \\[x] no'])('does not mistake literal syntax for a task: %s', (source) => {
    const doc = editorMarkdownParser.parse(source);
    expect(doc.firstChild?.firstChild?.attrs.checked).toBeNull();
  });

  it.each(['- [ ]', '- [x]', '- [ ]   '])('supports an empty task marker: %s', (source) => {
    const doc = editorMarkdownParser.parse(source);
    expect(doc.firstChild?.firstChild?.attrs.checked).toBe(source.includes('[x]'));
    expect(editorMarkdownParser.parse(editorMarkdownSerializer.serialize(doc)).eq(doc)).toBe(true);
  });

  it('toggles an imported checkbox and undoes the toggle', () => {
    vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
    const updates = vi.spyOn(EditorView.prototype, 'updateState');
    const changed = vi.fn();
    render(<Field initial={'- [ ] todo\n- [x] done\n\n<div>raw</div>'} changed={changed} />);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, true]);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(boxes[0]!);
    expect(changed.mock.lastCall?.[0]).toContain('[x] todo');
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);
    expect(changed.mock.lastCall?.[0]).toContain('<div>raw</div>');
    const view = updates.mock.instances[0] as EditorView;
    act(() => {
      expect(undo(view.state, view.dispatch)).toBe(true);
    });
    expect(changed.mock.lastCall?.[0]).toContain('[ ] todo');
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false);
  });

  it('creates a task using the toolbar and undoes the action', () => {
    vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
    const updates = vi.spyOn(EditorView.prototype, 'updateState');
    const changed = vi.fn();
    render(<Field initial="todo" changed={changed} />);
    screen.getByRole('textbox', { name: 'Description' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Task list' }));
    expect(changed.mock.lastCall?.[0]).toMatch(/\[ \] todo/);
    expect(screen.getByRole('checkbox')).toBeTruthy();
    const view = updates.mock.instances[0] as EditorView;
    act(() => {
      expect(undo(view.state, view.dispatch)).toBe(true);
    });
    expect(changed).toHaveBeenLastCalledWith('todo');
  });

  it('pastes Markdown tasks as editable checkboxes', () => {
    const changed = vi.fn();
    render(<Field initial="" changed={changed} />);
    const editor = screen.getByRole('textbox', { name: 'Description' });
    editor.focus();
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? '- [ ] todo\n- [x] done' : ''),
      },
    });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(changed.mock.lastCall?.[0]).toContain('[x] done');
  });

  it('splits a checked task into a new unchecked task', () => {
    vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
    const changed = vi.fn();
    render(<Field initial="- [x] done" changed={changed} />);
    const editor = screen.getByRole('textbox', { name: 'Description' });
    editor.focus();
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', keyCode: 13 });
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    expect(changed.mock.lastCall?.[0]).toContain('[ ]');
  });

  it('does not change a checkbox in a disabled field', () => {
    const changed = vi.fn();
    render(<Field initial="- [ ] todo" changed={changed} disabled />);
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.getAttribute('aria-label')).toBe('todo');
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it('localizes empty task names without replacing the editor, including when disabled', async () => {
    const changed = vi.fn();
    render(<Field initial="- [ ]" changed={changed} disabled />);
    const editor = screen.getByRole('textbox', { name: 'Description' });
    const box = screen.getByRole('checkbox', { name: 'Empty task' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    for (const [language, name] of [
      ['ru', 'Пустой пункт задачи'],
      ['es', 'Tarea vacía'],
      ['zh', '空任务'],
    ] as const) {
      await act(async () => {
        await i18next.changeLanguage(language);
      });
      expect(screen.getByRole('checkbox', { name })).toBe(box);
      expect(screen.getByRole('textbox', { name: 'Description' })).toBe(editor);
      expect(box.disabled).toBe(true);
      fireEvent.click(box);
      expect(box.checked).toBe(false);
    }
    expect(changed).not.toHaveBeenCalled();
  });

  it('edits and toggles an initially empty task, then undoes the edit', () => {
    vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
    const updates = vi.spyOn(EditorView.prototype, 'updateState');
    const changed = vi.fn();
    render(<Field initial="- [ ]" changed={changed} />);
    const editor = screen.getByRole('textbox', { name: 'Description' });
    editor.focus();
    fireEvent.paste(editor, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'todo' : '') },
    });
    expect(changed.mock.lastCall?.[0]).toContain('[ ] todo');
    const view = updates.mock.instances[0] as EditorView;
    act(() => {
      expect(undo(view.state, view.dispatch)).toBe(true);
    });
    expect(
      editorMarkdownParser.parse(changed.mock.lastCall![0]).firstChild?.firstChild?.attrs.checked,
    ).toBe(false);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(
      editorMarkdownParser.parse(changed.mock.lastCall![0]).firstChild?.firstChild?.attrs.checked,
    ).toBe(true);
  });

  it('keeps whitespace outside an edited task block intact', () => {
    const changed = vi.fn();
    render(<Field initial={'  intro\n\n\n- [ ]    todo\n\n\nend  \n'} changed={changed} />);
    fireEvent.click(screen.getByRole('checkbox'));
    const value = changed.mock.lastCall![0] as string;
    expect(value.startsWith('  intro\n\n\n')).toBe(true);
    expect(value.endsWith('\n\n\nend  \n')).toBe(true);
    expect(value).toContain('[x] todo');
  });
});
