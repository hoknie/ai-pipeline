// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepositoryMenu } from '../src/app/shell/menus/RepositoryMenu.tsx';
import { displayPaths, repositoryMatches } from '../src/shared/lib/catalog/repositories.ts';
import '../src/shared/i18n/index.ts';

import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';
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
