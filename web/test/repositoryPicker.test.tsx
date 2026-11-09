// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RepositoryPicker,
  matchRepositories,
} from '../src/features/repositories/RepositoryPicker.tsx';

import { rememberProjects } from '../src/shared/lib/catalog/repositories.ts';

import { repositoryView } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

afterEach(() => {
  cleanup();
});

const APP = '/work/app';
const LIB = '/work/lib';
const LIBRARY = '/work/library';
const ALL = [APP, LIB, LIBRARY];

function mount(onChange = vi.fn(), waiting = new Map<string, number>()) {
  render(
    <RepositoryPicker
      label="Repository"
      repositories={ALL}
      value={APP}
      waiting={waiting}
      onChange={onChange}
    />,
  );
  return { onChange, trigger: screen.getByRole('combobox', { name: 'Repository' }) };
}

describe('projects in the picker', () => {
  afterEach(() => rememberProjects([]));

  it('shows the name and the color of a project and finds it by its slug', () => {
    rememberProjects([
      repositoryView(APP, { name: 'Магазин', label: 'Магазин', slug: 'shop', color: 'teal' }),
    ]);
    expect(matchRepositories(ALL, 'SHOP')).toEqual([APP]);
    expect(matchRepositories(ALL, 'магаз')).toEqual([APP]);
    const { trigger } = mount();
    expect(trigger.textContent).toContain('Магазин');
    expect(trigger.querySelector('[data-project-color="teal"]')).toBeTruthy();
  });
});

describe('matchRepositories', () => {
  it('matches the directory name or the path without regard to case', () => {
    expect(matchRepositories(ALL, '')).toEqual(ALL);
    expect(matchRepositories(ALL, 'LIB')).toEqual([LIB, LIBRARY]);
    expect(matchRepositories(ALL, ' /WORK/ap ')).toEqual([APP]);
    expect(matchRepositories(ALL, 'nope')).toEqual([]);
  });
});

describe('repository picker', () => {
  it('shows the chosen repository with its path in the hint and the waiting counter', () => {
    const { trigger } = mount(vi.fn(), new Map([[APP, 2]]));
    expect(trigger.textContent).toContain('app');
    expect(trigger.getAttribute('title')).toBe(APP);
    expect(within(trigger).getByLabelText('waiting for an answer: 2').textContent).toBe('2');
  });

  it('lists the repositories in order, filters them and says when nothing is found', async () => {
    const { trigger } = mount();
    fireEvent.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'app/work/app',
      'lib/work/lib',
      'library/work/library',
    ]);
    const search = screen.getByPlaceholderText('Search repository…');
    fireEvent.change(search, { target: { value: 'LIB' } });
    await waitFor(() =>
      expect(screen.getAllByRole('option').map((option) => option.getAttribute('title'))).toEqual([
        LIB,
        LIBRARY,
      ]),
    );
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText('Nothing found')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('picks with a click and closes the list', async () => {
    const { trigger, onChange } = mount();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: /library/ }));
    expect(onChange).toHaveBeenCalledWith(LIBRARY);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('picks with the arrow and Enter', async () => {
    const { trigger, onChange } = mount();
    fireEvent.click(trigger);
    const search = await screen.findByPlaceholderText('Search repository…');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(ALL).toContain(onChange.mock.calls[0]?.[0]);
    expect(onChange.mock.calls[0]?.[0]).not.toBe(APP);
  });

  it('closes only the list on Escape', async () => {
    const { trigger, onChange } = mount();
    fireEvent.click(trigger);
    const search = await screen.findByPlaceholderText('Search repository…');
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByPlaceholderText('Search repository…')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
