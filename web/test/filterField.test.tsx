// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { FilterField, type FilterOption } from '../src/shared/ui/forms/filters/FilterField.tsx';
import '../src/shared/i18n/index.ts';

import { cleanup, fireEvent, render, screen, within } from './render.tsx';

afterEach(cleanup);

const options: FilterOption[] = [
  { value: 'a', label: 'Alpha', count: 3 },
  { value: 'b', label: 'Beta', count: 0, hint: '~/projects/beta' },
  { value: 'c', label: 'Gamma', count: 1 },
];

function Field({ initial = [] as string[], list = options }) {
  const [selected, setSelected] = useState(initial);
  return (
    <FilterField
      label="Things"
      options={list}
      selected={selected}
      onChange={setSelected}
      clearLabel="Clear"
    />
  );
}

describe('FilterField', () => {
  it('shows the label above the field and «Add» without chips while nothing is chosen', () => {
    render(<Field />);
    expect(screen.getByText('Things')).toBeTruthy();
    const add = screen.getByRole('combobox', { name: 'Things' });
    expect(add.getAttribute('aria-expanded')).toBe('false');
    expect(add.textContent).toBe('Add');
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('shows the chosen values as chips with the label of the option and removes one', () => {
    render(<Field initial={['a', 'zzz']} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    // a value without an option shows as itself
    expect(screen.getByText('zzz')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha' }));
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('zzz')).toBeTruthy();
  });

  it('searches by label and hint, and says when nothing is found', async () => {
    render(<Field />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Things' }));
    const search = await screen.findByPlaceholderText('Search…');
    fireEvent.change(search, { target: { value: 'gam' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'projects/beta' } });
    expect(screen.getByRole('option', { name: /Beta/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing found')).toBeTruthy();
  });

  it('toggles values without closing, shows counters, and puts the chosen ones first', async () => {
    render(<Field />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Things' }));
    expect(
      within(await screen.findByRole('option', { name: /Alpha/ })).getByText('3'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Gamma/ }));
    fireEvent.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(screen.getByRole('combobox', { name: 'Things' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Remove Alpha' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Gamma' })).toBeTruthy();
    expect(
      screen
        .getAllByRole('option')
        .slice(0, 3)
        .map((o) => o.textContent),
    ).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Gamma'),
      expect.stringContaining('Beta'),
    ]);
    fireEvent.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(screen.queryByRole('button', { name: 'Remove Alpha' })).toBeNull();
  });

  it('shows no counter without a count and gives headings to groups', async () => {
    render(
      <Field
        list={[
          { value: 'x', label: 'Mine', group: 'Own' },
          { value: 'y', label: 'Theirs', group: 'Shared' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Things' }));
    expect((await screen.findByRole('option', { name: 'Mine' })).textContent).toBe('Mine');
    expect(screen.getByText('Own')).toBeTruthy();
    expect(screen.getByText('Shared')).toBeTruthy();
  });

  it('clears the choice and closes with Escape', async () => {
    render(<Field initial={['a', 'b']} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Things' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Clear' }));
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Clear' })).toBeNull();
    fireEvent.keyDown(screen.getByPlaceholderText('Search…'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
