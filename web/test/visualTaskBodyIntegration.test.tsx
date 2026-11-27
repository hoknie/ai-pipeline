// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emptyDraft, fieldsOf, type QueueDraft } from '../src/features/queue/draft.ts';
import { TaskFields } from '../src/features/queue/form/TaskFields.tsx';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';
import { cleanup, fireEvent, markdownSource, render, screen, waitFor, within } from './render.tsx';

afterEach(cleanup);

function Form({
  initial,
  locked = false,
  save,
}: {
  initial: QueueDraft;
  locked?: boolean;
  save: (fields: ReturnType<typeof fieldsOf>) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <TaskFields
        state={{
          idPrefix: 'test',
          effective: draft,
          locked,
          change: (patch) => setDraft((d) => ({ ...d, ...patch })),
        }}
      />
      <button onClick={() => save(fieldsOf(draft))}>Save draft</button>
    </>
  );
}

describe('visual task body integration', () => {
  it('saves the edited Markdown from the queue form without changing it on mode switches', () => {
    const save = vi.fn();
    const original = 'First **important** sentence';
    render(<Form initial={{ ...emptyDraft('feature'), task: original }} save={save} />);
    const visual = screen.getByRole('textbox', { name: 'Task text' });
    expect(within(visual).getByText('important').tagName).toBe('STRONG');
    const source = markdownSource(visual);
    expect(source.value).toBe(original);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(source, { target: { value: 'First _important_ sentence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(screen.getByText('important').tagName).toBe('EM');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'First _important_ sentence' }),
    );
  });

  it('reflects external values in both modes without reporting a user edit', () => {
    const change = vi.fn();
    const field = (value: string) => (
      <MarkdownField aria-label="Body" value={value} onChange={change} />
    );
    const { rerender } = render(field('Before'));
    rerender(field('After **external**'));
    expect(screen.getByText('external').tagName).toBe('STRONG');
    const source = markdownSource(screen.getByRole('textbox', { name: 'Body' }));
    rerender(field('Another _update_'));
    expect(source.value).toBe('Another _update_');
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(screen.getByText('update').tagName).toBe('EM');
    expect(change).not.toHaveBeenCalled();
  });

  it('keeps two group editors, their modes and saved bodies independent', () => {
    const save = vi.fn();
    const draft = {
      ...emptyDraft('feature'),
      mode: 'groups' as const,
      groups: [
        { title: 'One', task: 'First **body**' },
        { title: 'Two', task: 'Second _body_' },
      ],
    };
    render(<Form initial={draft} save={save} />);
    const first = screen.getByRole('textbox', { name: 'Text of group 1' });
    const second = screen.getByRole('textbox', { name: 'Text of group 2' });
    const source = markdownSource(second);
    expect(source.value).toBe('Second _body_');
    expect(first.getAttribute('contenteditable')).toBe('true');
    fireEvent.change(source, { target: { value: 'Changed **second**' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [
          { title: 'One', task: 'First **body**' },
          { title: 'Two', task: 'Changed **second**' },
        ],
      }),
    );
  });

  it('keeps a locked task readable in both modes and disables editing controls', () => {
    const save = vi.fn();
    render(
      <Form initial={{ ...emptyDraft('feature'), task: '**Important**' }} locked save={save} />,
    );
    const visual = screen.getByRole('textbox', { name: 'Task text' });
    expect(visual.getAttribute('contenteditable')).toBe('false');
    expect(within(visual).getByText('Important').tagName).toBe('STRONG');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Bold' }).disabled).toBe(true);
    const source = markdownSource(visual);
    expect(document.activeElement).toBe(source);
    expect(source.value).toBe('**Important**');
    expect(source.readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    const restored = screen.getByRole('textbox', { name: 'Task text' });
    expect(document.activeElement).toBe(restored);
    expect(restored.getAttribute('contenteditable')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ task: '**Important**' }));
  });

  it('opens the second group link editor as the first toolbar action without focusing its body', () => {
    const save = vi.fn();
    render(
      <Form
        initial={{
          ...emptyDraft('feature'),
          mode: 'groups',
          groups: [
            { title: 'One', task: 'First' },
            { title: 'Two', task: '' },
          ],
        }}
        save={save}
      />,
    );
    screen.getByDisplayValue('One').focus();
    fireEvent.click(screen.getAllByRole('button', { name: /^Link$/ })[1]!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Link text' }), {
      target: { value: 'guide' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Link destination' }), {
      target: { value: 'docs/guide.md' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Text of group 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [
          { title: 'One', task: 'First' },
          { title: 'Two', task: '[guide](docs/guide.md)' },
        ],
      }),
    );
  });

  it('moves keyboard focus between toolbar controls and into each editing mode', async () => {
    render(<Form initial={{ ...emptyDraft('feature'), task: 'Text' }} save={vi.fn()} />);
    const bold = screen.getByRole('button', { name: 'Bold' });
    bold.focus();
    fireEvent.keyDown(bold, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Italic' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Task text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Task text' }));
  });
});
