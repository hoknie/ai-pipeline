// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { FilterSelect } from '../src/shared/ui/forms/FilterSelect.tsx';
import '../src/shared/i18n/index.ts';

import { cleanup, fireEvent, render, screen, within } from './render.tsx';

afterEach(cleanup);

const options = [
  { value: 'a', label: 'Alpha', count: 3 },
  { value: 'b', label: 'Beta', count: 0, hint: '~/projects/beta' },
  { value: 'c', label: 'Gamma', count: 1 },
];

function Select({ initial = [] as string[] }) {
  const [selected, setSelected] = useState(initial);
  return (
    <FilterSelect
      label="Things"
      options={options}
      selected={selected}
      onChange={setSelected}
      clearLabel="Clear"
    />
  );
}

describe('FilterSelect', () => {
  it('has a combobox button without a number while nothing is chosen', () => {
    render(<Select />);
    const button = screen.getByRole('combobox', { name: 'Things' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(within(button).queryByText(/^\d+$/)).toBeNull();
  });

  it('searches by label and hint, and says when nothing is found', async () => {
    render(<Select />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Things' }));
    const search = await screen.findByPlaceholderText('Search…');
    fireEvent.change(search, { target: { value: 'gam' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'projects/beta' } });
    expect(screen.getByRole('option', { name: /Beta/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing found')).toBeTruthy();
  });

  it('toggles values without closing, shows counters and the number on the button', async () => {
    render(<Select />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Things' }));
    expect(
      within(await screen.findByRole('option', { name: /Alpha/ })).getByText('3'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Gamma/ }));
    fireEvent.click(screen.getByRole('option', { name: /Alpha/ }));
    const button = screen.getByRole('combobox', { name: 'Things' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(within(button).getByText('2')).toBeTruthy();
    // chosen values come first
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
    expect(within(button).getByText('1')).toBeTruthy();
  });

  it('clears the choice and closes with Escape', async () => {
    render(<Select initial={['a', 'b']} />);
    const button = screen.getByRole('combobox', { name: 'Things' });
    expect(within(button).getByText('2')).toBeTruthy();
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('option', { name: 'Clear' }));
    expect(within(button).queryByText('2')).toBeNull();
    fireEvent.keyDown(screen.getByPlaceholderText('Search…'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
