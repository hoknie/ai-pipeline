// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import type { Api } from '../src/api.ts';
import { TAG_CLASSES } from '../src/tagColors.ts';
import { ApiError } from '../src/api.ts';
import { TAG_COLORS } from '../../src/core/tags.ts';

import { act, cleanup, choose, fireEvent, render, screen, waitFor, within } from './render.tsx';
import {
  FakeEventSource,
  fakeApi,
  openFake,
  queueOf,
  runView,
  tagView,
  workflowsView,
} from './fixtures.ts';
import type { TagView } from '../src/types.ts';

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#runs';
});
afterEach(() => cleanup());

function stream(): FakeEventSource {
  const source = FakeEventSource.last;
  if (!source) throw new Error('no event source');
  return source;
}

/** Opens the panel with a catalog and runs delivered by the first snapshot. */
function boot(
  hash: string,
  tags: TagView[],
  runs = [runView()],
  overrides: Partial<Api> = {},
): ReturnType<typeof fakeApi> {
  window.location.hash = hash;
  const api = fakeApi({ runs: vi.fn(async () => runs), ...overrides });
  render(<App api={api} openStream={openFake} />);
  act(() => {
    stream().open();
    stream().send({ event: 'snapshot', seq: 1, runs, tags });
  });
  return api;
}

const luminance = (hex: string) => {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('tag colors', () => {
  it('has a light and a dark pair for every palette color with contrast of at least 4.5:1', () => {
    expect(Object.keys(TAG_CLASSES).sort()).toEqual([...TAG_COLORS].sort());
    for (const [color, classes] of Object.entries(TAG_CLASSES)) {
      const pick = (prefix: string) =>
        new RegExp(`(?:^| )${prefix}-\\[(#[0-9a-f]{6})\\]`).exec(classes)![1]!;
      expect(contrast(pick('bg'), pick('text')), `${color} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(pick('dark:bg'), pick('dark:text')), `${color} dark`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});

describe('tag chips', () => {
  it('shows a rename without a reload and keeps the color', async () => {
    boot(
      '#runs',
      [tagView('auth', 'red', 'a')],
      [runView({ tags: [tagView('auth', 'red', 'a')] })],
    );
    const list = await screen.findByRole('list');
    const chip = within(list).getByText('auth').closest('[data-tag]')!;
    expect(chip.className).toContain('bg-[#fee2e2]');
    act(() => stream().send({ event: 'tags', seq: 2, tags: [tagView('login', 'red', 'a')] }));
    expect(within(list).queryByText('auth')).toBeNull();
    expect(within(list).getByText('login').closest('[data-tag]')!.className).toContain(
      'bg-[#fee2e2]',
    );
  });

  it('does not show a tag that is not in the catalog', async () => {
    boot('#runs', [], [runView({ tags: [tagView('ghost', 'red', 'g')] })]);
    const list = await screen.findByRole('list');
    expect(within(list).queryByText('ghost')).toBeNull();
    expect(list.querySelector('[data-tags]')).toBeNull();
  });
});

describe('tag picker in the task form', () => {
  const openForm = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'New task' }));
    await screen.findByRole('dialog', { name: 'New task' });
  };
  const openPicker = async () => {
    await openForm();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Tags' }));
    return screen.findByRole('combobox', { name: 'Search in Tags' });
  };
  const queueApi = (overrides: Partial<Api> = {}) => ({
    queue: vi.fn(async () => queueOf()),
    workflows: vi.fn(async () => workflowsView()),
    ...overrides,
  });

  it('creates a tag right in the form and selects it', async () => {
    const api = boot('#queue', [], [runView()], queueApi());
    const input = await openPicker();
    fireEvent.change(input, { target: { value: 'billing' } });
    act(() => undefined);
    fireEvent.click(await screen.findByRole('option', { name: 'Create tag «billing»' }));
    await waitFor(() => expect(api.addTag).toHaveBeenCalledWith('billing'));
    const field = (await screen.findByRole('combobox', { name: 'Tags' })).parentElement!;
    await waitFor(() => expect(within(field).getByText('billing')).toBeTruthy());
  });

  it('sizes the field by its content instead of stretching it', async () => {
    boot('#queue', [tagView('auth')], [runView()], queueApi());
    await openForm();
    const field = (await screen.findByRole('combobox', { name: 'Tags' })).parentElement!;
    expect(field.classList.contains('w-fit')).toBe(true);
    expect(field.classList.contains('max-w-full')).toBe(true);
    expect(field.classList.contains('w-full')).toBe(false);
    expect(field.classList.contains('flex-1')).toBe(false);
  });

  it('matches a name without case: offers the tag and not the creation', async () => {
    boot('#queue', [tagView('auth')], [runView()], queueApi());
    const input = await openPicker();
    fireEvent.change(input, { target: { value: 'AUTH' } });
    expect(await screen.findByRole('option', { name: 'auth' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Create tag/ })).toBeNull();
  });

  it('shows a creation error at the field and keeps the selection', async () => {
    boot(
      '#queue',
      [tagView('auth')],
      [runView()],
      queueApi({
        addTag: vi.fn(async () => {
          throw new ApiError(400, 'tag name is too long');
        }),
      }),
    );
    const input = await openPicker();
    fireEvent.click(await screen.findByRole('option', { name: 'auth' }));
    fireEvent.change(input, { target: { value: 'x'.repeat(40) } });
    fireEvent.click(await screen.findByRole('option', { name: /Create tag/ }));
    expect((await screen.findByText('tag name is too long')).getAttribute('role')).toBe('alert');
    const field = screen.getByRole('combobox', { name: 'Tags' }).parentElement!;
    expect(within(field).getByText('auth')).toBeTruthy();
  });
});

describe('tags of a run', () => {
  it('adds a tag to a finished run and shows it in the header and the list', async () => {
    const done = runView({ finished: true, state: 'finished' });
    const api = boot('#runs/run1', [tagView('auth')], [done]);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Run tags' }));
    fireEvent.click(await screen.findByRole('option', { name: 'auth' }));
    await waitFor(() => expect(api.setRunTags).toHaveBeenCalledWith('run1', { add: ['auth'] }));
    act(() => stream().send({ event: 'run', seq: 2, run: { ...done, tags: [tagView('auth')] } }));
    const header = document.querySelector('header[aria-label]') as HTMLElement;
    expect(within(header).getByText('auth')).toBeTruthy();
    expect(
      within(document.querySelector('li[data-run="run1"]') as HTMLElement).getByText('auth'),
    ).toBeTruthy();
  });

  it('creates a tag in the run header and adds it to the run', async () => {
    const done = runView({ finished: true, state: 'finished' });
    const api = boot('#runs/run1', [], [done]);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Run tags' }));
    const input = await screen.findByRole('combobox', { name: 'Search in Run tags' });
    fireEvent.change(input, { target: { value: 'billing' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Create tag «billing»' }));
    await waitFor(() => expect(api.addTag).toHaveBeenCalledWith('billing'));
    await waitFor(() => expect(api.setRunTags).toHaveBeenCalledWith('run1', { add: ['billing'] }));
  });

  it('shows the error at the tags and leaves them as they were', async () => {
    const api = boot('#runs/run1', [tagView('auth')], [runView()], {
      setRunTags: vi.fn(async () => {
        throw new ApiError(400, 'daemon says no');
      }),
    });
    fireEvent.click(await screen.findByRole('combobox', { name: 'Run tags' }));
    fireEvent.click(await screen.findByRole('option', { name: 'auth' }));
    expect(await screen.findByText('daemon says no')).toBeTruthy();
    expect(api.setRunTags).toHaveBeenCalledTimes(1);
    const header = document.querySelector('header[aria-label]') as HTMLElement;
    expect(within(header).queryByText('auth')).toBeNull();
  });
});

describe('tags in the general settings', () => {
  const settings = (tags: TagView[], overrides: Partial<Api> = {}) =>
    boot('#specialists/_settings', tags, [runView()], overrides);

  it('recolors a tag', async () => {
    const api = settings([tagView('auth', 'blue', 'a')], {
      editTag: vi.fn(async () => [tagView('auth', 'green', 'a')]),
    });
    const section = await screen.findByRole('region', { name: 'Tags' });
    choose(within(section).getByRole('combobox', { name: 'Color of tag auth' }), 'Green');
    await waitFor(() => expect(api.editTag).toHaveBeenCalledWith('auth', { color: 'green' }));
    await waitFor(() =>
      expect(
        within(section)
          .getAllByText('auth')
          .find((node) => node.closest('[data-tag]'))!
          .closest('[data-tag]')!.className,
      ).toContain('bg-[#dcfce7]'),
    );
  });

  it('asks before deleting and then drops the tag', async () => {
    const api = settings([tagView('auth', 'blue', 'a')], { removeTag: vi.fn(async () => []) });
    const section = await screen.findByRole('region', { name: 'Tags' });
    fireEvent.click(within(section).getByRole('button', { name: 'Delete tag auth' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/removed from all tasks and runs/)).toBeTruthy();
    expect(api.removeTag).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.removeTag).toHaveBeenCalledWith('auth'));
    await waitFor(() => expect(within(section).queryByLabelText('Name of tag auth')).toBeNull());
  });

  it('shows the error of a taken name and restores the field', async () => {
    const api = settings([tagView('auth', 'blue', 'a'), tagView('v2', 'red', 'b')], {
      editTag: vi.fn(async () => {
        throw new ApiError(400, 'tag `auth` already exists');
      }),
    });
    const section = await screen.findByRole('region', { name: 'Tags' });
    const field = within(section).getByLabelText<HTMLInputElement>('Name of tag v2');
    fireEvent.change(field, { target: { value: 'Auth' } });
    fireEvent.blur(field);
    await waitFor(() => expect(api.editTag).toHaveBeenCalledWith('v2', { name: 'Auth' }));
    expect(await within(section).findByText('tag `auth` already exists')).toBeTruthy();
    await waitFor(() => expect(field.value).toBe('v2'));
  });
});
