// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LinksEditor,
  type LinkRow,
  type LinkKind,
  type LinkTargetGroup,
} from '../src/features/runs/index.ts';
import { chooseKind, kindOptions } from './linkKind.ts';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(cleanup);

const long = 'A very long task title '.repeat(12);
const choices = (kind: LinkKind): LinkTargetGroup[] => [
  { section: 'items', options: [{ id: 'a', number: 7, title: long }] },
  ...(kind === 'blocked_by'
    ? []
    : [
        {
          section: 'other' as const,
          options: [{ id: 'b', number: 8, title: 'API', project: 'lib' }],
        },
      ]),
];

function Example({
  initial = [],
  editableKinds,
}: {
  initial?: LinkRow[];
  editableKinds?: LinkKind[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <LinksEditor
      value={value}
      onChange={setValue}
      choices={choices}
      editableKinds={editableKinds}
    />
  );
}

describe('LinksEditor', () => {
  it('adds and removes rows and allows only one parent', async () => {
    render(<Example />);
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    await chooseKind(screen.getByRole('combobox', { name: 'Link kind' }), 'Parent');
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const kinds = screen.getAllByRole('combobox', { name: 'Link kind' });
    const options = await kindOptions(kinds[1]!);
    expect(
      options.find((option) => option.textContent === 'Parent')?.hasAttribute('data-disabled'),
    ).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove link' })[0]!);
    const left = await kindOptions(screen.getByRole('combobox', { name: 'Link kind' }));
    expect(
      left.find((option) => option.textContent === 'Parent')?.hasAttribute('data-disabled'),
    ).toBe(false);
  });

  it('keeps non-editable links locked and adds only allowed kinds', () => {
    render(<Example initial={[{ kind: 'parent', target: 'a' }]} editableKinds={['blocked_by']} />);
    expect(
      (screen.getByRole('combobox', { name: 'Link kind' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('combobox', { name: 'Linked task' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Remove link' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getAllByRole('combobox', { name: 'Link kind' })[1]!.textContent).toBe(
      'Blocked by',
    );
  });

  it('draws the kind as the select of the form and the add button as a button with a plus', () => {
    render(<Example initial={[{ kind: 'related', target: '' }]} />);
    const kind = screen.getByRole('combobox', { name: 'Link kind' });
    expect(kind.tagName).toBe('BUTTON');
    expect(kind.className).toContain('h-9.5');
    const add = screen.getByRole('button', { name: 'Add link' });
    expect(add.className).toContain('border');
    expect(add.querySelector('svg')).not.toBeNull();
  });

  it('clears a target that is unavailable after changing the kind', async () => {
    render(<Example initial={[{ kind: 'related', target: 'b' }]} />);
    expect(screen.getByRole('combobox', { name: 'Linked task' }).textContent).toContain('lib');
    await chooseKind(screen.getByRole('combobox', { name: 'Link kind' }), 'Blocked by');
    expect(screen.getByRole('combobox', { name: 'Linked task' }).textContent).toBe('Linked task');
  });

  it('retains a target offered for the new kind', async () => {
    render(<Example initial={[{ kind: 'related', target: 'a' }]} />);
    await chooseKind(screen.getByRole('combobox', { name: 'Link kind' }), 'Blocked by');
    expect(screen.getByRole('combobox', { name: 'Linked task' }).getAttribute('title')).toBe(
      `#7 ${long}`,
    );
  });

  it('searches groups by project and preserves long option and selected labels', async () => {
    render(<Example initial={[{ kind: 'related', target: '' }]} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Linked task' }));
    const option = await screen.findByRole('option', { name: /A very long task title/ });
    expect(option.getAttribute('title')).toBe(`#7 ${long}`);
    expect(option.querySelector('.line-clamp-3')).not.toBeNull();
    expect(screen.getByText('Waiting tasks')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Search in Linked task' }), {
      target: { value: 'lib' },
    });
    expect(screen.getByRole('option', { name: /lib · #8 API/ })).toBeTruthy();
    expect(screen.queryByText('Waiting tasks')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Search in Linked task' }), {
      target: { value: '#7' },
    });
    fireEvent.click(screen.getByRole('option', { name: /A very long task title/ }));
    const selected = screen.getByRole('combobox', { name: 'Linked task' });
    expect(selected.getAttribute('title')).toBe(`#7 ${long}`);
    expect(selected.querySelector('.truncate')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Remove link' })).toBeTruthy();
  });
});
