// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepositoryMenu } from '../src/app/shell/menus/RepositoryMenu.tsx';
import { displayPaths, repositoryMatches } from '../src/shared/lib/catalog/repositories.ts';
import '../src/shared/i18n/index.ts';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { repositoryView } from './fixtures.ts';

afterEach(cleanup);

const paths = new Map([
  ['/Users/me/projects/shop', '~/projects/shop'],
  ['/Users/me/projects/blog', '~/projects/blog'],
  [
    '/srv/very/long/path/to/the/deeply/nested/repository-named-api',
    '/srv/very/long/path/to/the/deeply/nested/repository-named-api',
  ],
]);

function menu(onSelect = vi.fn(), onAdd = vi.fn(async () => undefined)) {
  render(
    <RepositoryMenu
      choice={{
        repositories: [...paths.keys()],
        paths,
        selected: '/Users/me/projects/shop',
        waiting: new Map(),
        onSelect,
        onAdd,
        browse: async () => ({
          path: '/Users/me',
          parent: '/Users',
          home: '/Users/me',
          git: false,
          entries: [],
          truncated: false,
        }),
      }}
    />,
  );
  fireEvent.pointerDown(screen.getByRole('button', { name: /Repository: shop/ }), {
    button: 0,
    ctrlKey: false,
  });
}

describe('RepositoryMenu', () => {
  it('shows the path under the name, whole, and limits the height of the list', async () => {
    menu();
    expect(await screen.findByText('~/projects/blog')).toBeTruthy();
    const long = screen.getByText('/srv/very/long/path/to/the/deeply/nested/repository-named-api');
    expect(long.className).toContain('break-all');
    expect(long.className).not.toContain('truncate');
    const list = document.querySelector('[data-repository-list]') as HTMLElement;
    expect(list.className).toContain('max-h-[calc(3.25rem*5.5)]');
    expect(list.className).toContain('overflow-y-auto');
  });

  it('searches by name and by path, says when nothing is found, and still adds', async () => {
    const onAdd = vi.fn(async () => undefined);
    menu(vi.fn(), onAdd);
    const search = await screen.findByPlaceholderText('Search projects…');
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: 'BLOG' } });
    expect(screen.queryByText('~/projects/shop')).toBeNull();
    expect(screen.getByText('~/projects/blog')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'deeply/nested' } });
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('Nothing found')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Add repository/ })).toBeTruthy();
  });

  it('selects a found repository', async () => {
    const onSelect = vi.fn();
    menu(onSelect);
    const search = await screen.findByPlaceholderText('Search projects…');
    fireEvent.change(search, { target: { value: 'blog' } });
    fireEvent.click(screen.getByRole('menuitemradio', { name: /blog/ }));
    expect(onSelect).toHaveBeenCalledWith('/Users/me/projects/blog');
  });
});

describe('repository paths', () => {
  it('takes the path to show from the registry', () => {
    const registry = [
      repositoryView('/Users/me/app', { displayPath: '~/app' }),
      repositoryView('/srv/lib'),
    ];
    expect(displayPaths(registry).get('/Users/me/app')).toBe('~/app');
    expect(displayPaths(registry).get('/srv/lib')).toBe('/srv/lib');
  });

  it('matches by name, path and shown path ignoring case', () => {
    expect(repositoryMatches('/Users/me/App', '~/App', 'app')).toBe(true);
    expect(repositoryMatches('/Users/me/app', '~/app', '~/ap')).toBe(true);
    expect(repositoryMatches('/Users/me/app', '~/app', 'users/me')).toBe(true);
    expect(repositoryMatches('/Users/me/app', '~/app', 'zzz')).toBe(false);
    expect(repositoryMatches('/x', '/x', '  ')).toBe(true);
  });
});

describe('the item «All projects»', () => {
  const browse = async () => ({
    path: '/Users/me',
    parent: '/Users',
    home: '/Users/me',
    git: false,
    entries: [],
    truncated: false,
  });

  function open(choice: Partial<React.ComponentProps<typeof RepositoryMenu>['choice']> = {}) {
    const onAllProjects = vi.fn();
    const onSelect = vi.fn();
    render(
      <RepositoryMenu
        choice={{
          repositories: [...paths.keys()],
          paths,
          selected: '/Users/me/projects/shop',
          waiting: new Map([['/Users/me/projects/blog', 2]]),
          onSelect,
          onAllProjects,
          onAdd: async () => undefined,
          browse,
          ...choice,
        }}
      />,
    );
    const trigger = document.querySelector<HTMLElement>('[data-repository-trigger]')!;
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    return { onAllProjects, onSelect, trigger };
  }

  it('comes first, above the list, and turns the mode on', async () => {
    const { onAllProjects, onSelect } = open();
    const items = await screen.findAllByRole('menuitemradio');
    expect(items[0]!.textContent).toBe('All projects');
    expect(items).toHaveLength(4);
    expect(document.querySelector('[data-repository-list]')!.contains(items[0]!)).toBe(false);
    fireEvent.click(items[0]!);
    expect(onAllProjects).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('stays when the search finds nothing', async () => {
    open();
    const search = await screen.findByPlaceholderText('Search projects…');
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByRole('menuitemradio', { name: 'All projects' })).toBeTruthy();
    expect(screen.getByText('Nothing found')).toBeTruthy();
  });

  it('shows «All projects» on the button with the waiting runs of every project', () => {
    const { trigger } = open({ allProjects: true });
    expect(trigger.getAttribute('aria-label')).toBe('Repository: All projects');
    expect(within(trigger).getByLabelText('waiting for an answer: 2').textContent).toBe('2');
  });

  it('is absent without projects', async () => {
    open({ repositories: [] });
    await screen.findByRole('menuitem', { name: 'Add repository…' });
    expect(screen.queryByRole('menuitemradio', { name: 'All projects' })).toBeNull();
  });
});

describe('the key ctrl+p', () => {
  const choice = (selected: string | null) => ({
    repositories: [...paths.keys()],
    paths,
    selected,
    waiting: new Map<string, number>(),
    onSelect: vi.fn(),
    onAdd: vi.fn(async () => undefined),
    browse: vi.fn(),
  });

  it('opens the menu with the focus in the search field', async () => {
    render(<RepositoryMenu choice={choice('/Users/me/projects/shop')} />);
    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP', ctrlKey: true });
    const search = await screen.findByRole('searchbox');
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it('does nothing without a selected project', () => {
    render(<RepositoryMenu choice={choice(null)} />);
    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP', ctrlKey: true });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('is typed into an input field instead', () => {
    render(
      <>
        <input aria-label="other" />
        <RepositoryMenu choice={choice('/Users/me/projects/shop')} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText('other'), { key: 'p', code: 'KeyP', ctrlKey: true });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
