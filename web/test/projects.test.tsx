// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { ApiError, type Api } from '../src/shared/api/api.ts';
import type { RepositoryView } from '../src/shared/api/types.ts';

import { FakeEventSource, fakeApi, openFake, queueOf, repositoryView } from './fixtures.ts';

const APP = '/work/app';
const LIB = '/work/lib';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function show(
  registry: RepositoryView[],
  hash: string,
  overrides: Partial<Api> = {},
): Promise<Api> {
  window.location.hash = hash;
  const api = fakeApi({ queue: vi.fn(async () => queueOf({ repository: APP })), ...overrides });
  render(<App api={api} openStream={openFake} />);
  // the page is loaded lazily: the stream and the page are up before the snapshot arrives
  await screen.findByRole('banner');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  act(() => {
    FakeEventSource.last?.send({
      event: 'snapshot',
      seq: 1,
      runs: [],
      queues: [queueOf({ repository: APP }), queueOf({ repository: LIB })],
      repositories: registry,
    });
  });
  return api;
}

const list = () => screen.getByRole('list', { name: 'projects' });
const projectForm = (name: string) => screen.findByRole('form', { name: `project ${name}` });

describe('the group Projects', () => {
  it('stands before System and lists every project, disabled ones marked', async () => {
    await show(
      [repositoryView(APP, { waiting: 2 }), repositoryView(LIB, { enabled: false })],
      '#settings/global/projects',
    );
    const nav = await screen.findByRole('navigation', { name: 'groups of settings' });
    const groups = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(groups.slice(-2)).toEqual(['Projects', 'System']);
    await waitFor(() => expect(within(list()).getAllByRole('button')).toHaveLength(2));
    const rows = within(list()).getAllByRole('button');
    expect(rows[0]!.textContent).toContain('app');
    expect(rows[0]!.textContent).toContain('2');
    expect(rows[1]!.textContent).toContain('Disabled');
    expect(screen.getByText('Choose a project on the left')).toBeTruthy();
    expect(screen.getByText(/kept in the daemon's database/)).toBeTruthy();
  });

  it('finds a project by its slug and opens its form at its address', async () => {
    await show(
      [
        repositoryView(APP, { name: 'Магазин', label: 'Магазин', slug: 'shop' }),
        repositoryView(LIB),
      ],
      '#settings/global/projects',
    );
    await waitFor(() => expect(within(list()).getAllByRole('button')).toHaveLength(2));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), {
      target: { value: 'SHO' },
    });
    const rows = within(list()).getAllByRole('button');
    expect(rows).toHaveLength(1);
    fireEvent.click(rows[0]!);
    await projectForm('Магазин');
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/projects/shop'));
  });

  it('shows the fields and the facts of a project', async () => {
    await show(
      [repositoryView(APP, { color: 'teal', unfinished: 2 })],
      '#settings/global/projects/app',
    );
    const form = within(await projectForm('app'));
    const name = form.getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('');
    expect(name.placeholder).toBe('app');
    expect((form.getByLabelText('Slug') as HTMLInputElement).value).toBe('app');
    expect(form.getByText(APP)).toBeTruthy();
    expect(form.getByRole('switch', { name: 'Enabled' }).getAttribute('aria-checked')).toBe('true');
    expect(form.getByRole('radio', { name: 'Teal' }).getAttribute('aria-checked')).toBe('true');
    expect(form.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    expect(form.getByText('Unfinished runs').nextSibling?.textContent).toBe('2');
  });

  it('saves the name and shows it in the repository menu', async () => {
    const updateRepository = vi.fn(async () => [
      repositoryView(APP, { name: 'Магазин', label: 'Магазин' }),
    ]);
    const api = await show([repositoryView(APP)], '#settings/global/projects/app', {
      updateRepository,
    });
    const form = within(await projectForm('app'));
    fireEvent.change(form.getByLabelText('Name'), { target: { value: ' Магазин ' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateRepository).toHaveBeenCalledWith(APP, { name: 'Магазин' }),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-repository-trigger]')?.getAttribute('aria-label')).toBe(
        'Repository: Магазин',
      ),
    );
  });

  it('keeps the typed slug and shows the refusal at the field', async () => {
    const updateRepository = vi.fn(async () => {
      throw new ApiError(400, 'project slug `lib` is taken');
    });
    await show([repositoryView(APP), repositoryView(LIB)], '#settings/global/projects/app', {
      updateRepository,
    });
    const form = within(await projectForm('app'));
    fireEvent.change(form.getByLabelText('Slug'), { target: { value: 'lib' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect((await form.findByRole('alert')).textContent).toContain('is taken');
    expect((form.getByLabelText('Slug') as HTMLInputElement).value).toBe('lib');
  });

  it('follows a new slug in the address', async () => {
    const updateRepository = vi.fn(async () => [repositoryView(APP, { slug: 'shop' })]);
    await show([repositoryView(APP)], '#settings/global/projects/app', { updateRepository });
    const form = within(await projectForm('app'));
    fireEvent.change(form.getByLabelText('Slug'), { target: { value: 'shop' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/projects/shop'));
  });

  it('asks before leaving a form with unsaved changes', async () => {
    await show([repositoryView(APP), repositoryView(LIB)], '#settings/global/projects/app');
    const form = within(await projectForm('app'));
    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'X' } });
    fireEvent.click(within(list()).getAllByRole('button')[1]!);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(window.location.hash).toBe('#settings/global/projects/app');
    expect((form.getByLabelText('Name') as HTMLInputElement).value).toBe('X');
  });

  it('disabling the selected repository selects the default and hides it in the menu', async () => {
    const updateRepository = vi.fn(async () => [
      repositoryView(APP, { addedAt: 2, enabled: false }),
      repositoryView(LIB, { addedAt: 1 }),
    ]);
    await show(
      [repositoryView(APP, { addedAt: 2 }), repositoryView(LIB, { addedAt: 1 })],
      '#settings/global/projects/app',
      { updateRepository },
    );
    const form = within(await projectForm('app'));
    fireEvent.click(form.getByRole('switch', { name: 'Enabled' }));
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(document.querySelector('[data-repository-trigger]')?.getAttribute('aria-label')).toBe(
        'Repository: lib',
      ),
    );
    expect(await screen.findByText(/The project is disabled/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Project settings' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('adds a project from the form of a new one and opens it', async () => {
    const addRepository = vi.fn(async () => [
      repositoryView(APP),
      repositoryView('/work/new', { name: 'New', label: 'New', slug: 'new-one' }),
    ]);
    const api = await show([repositoryView(APP)], '#settings/global/projects/new', {
      addRepository,
    });
    const form = within(await screen.findByRole('form', { name: 'New project' }));
    fireEvent.change(form.getByLabelText('Path'), { target: { value: '/work/new/src' } });
    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'New' } });
    fireEvent.click(form.getByRole('button', { name: 'Add project' }));
    await waitFor(() =>
      expect(api.addRepository).toHaveBeenCalledWith('/work/new/src', { name: 'New' }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/projects/new-one'));
  });

  it('keeps the path when the daemon refuses it', async () => {
    const addRepository = vi.fn(async () => {
      throw new ApiError(400, '/tmp is not inside a git repository');
    });
    await show([repositoryView(APP)], '#settings/global/projects/new', { addRepository });
    const form = within(await screen.findByRole('form', { name: 'New project' }));
    fireEvent.change(form.getByLabelText('Path'), { target: { value: '/tmp' } });
    fireEvent.click(form.getByRole('button', { name: 'Add project' }));
    expect((await form.findByRole('alert')).textContent).toContain('not inside a git repository');
    expect((form.getByLabelText('Path') as HTMLInputElement).value).toBe('/tmp');
  });

  it('changes the path, and a refusal stays in the dialog', async () => {
    const moveRepository = vi
      .fn<Api['moveRepository']>()
      .mockRejectedValueOnce(new ApiError(400, 'repository has unfinished runs: 1'))
      .mockResolvedValueOnce([repositoryView('/projects/app', { slug: 'app' })]);
    await show([repositoryView(APP)], '#settings/global/projects/app', { moveRepository });
    const form = within(await projectForm('app'));
    fireEvent.click(form.getByRole('button', { name: 'Change path…' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('New path'), { target: { value: '/projects/app' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Change path' }));
    expect((await dialog.findByRole('alert')).textContent).toContain('unfinished runs');
    fireEvent.click(dialog.getByRole('button', { name: 'Change path' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await projectForm('app')).textContent).toContain('/projects/app');
    expect(window.location.hash).toBe('#settings/global/projects/app');
  });

  it('starts the new path from the current one and picks a folder in the browser', async () => {
    const moveRepository = vi
      .fn<Api['moveRepository']>()
      .mockResolvedValue([repositoryView('/home/me/code/app', { slug: 'app' })]);
    const directories = vi.fn<Api['directories']>(async (path) =>
      path === '/home/me/code'
        ? {
            path: '/home/me/code',
            parent: '/home/me',
            home: '/home/me',
            git: false,
            entries: [{ name: 'app', path: '/home/me/code/app', git: true }],
            truncated: false,
          }
        : path === '/home/me/code/app'
          ? {
              path: '/home/me/code/app',
              parent: '/home/me/code',
              home: '/home/me',
              git: true,
              entries: [],
              truncated: false,
            }
          : Promise.reject(new ApiError(404, `${path} is not a directory`)),
    );
    await show(
      [repositoryView(APP, { displayPath: '~/old/app' })],
      '#settings/global/projects/app',
      {
        moveRepository,
        directories,
      },
    );
    const form = within(await projectForm('app'));
    fireEvent.click(form.getByRole('button', { name: 'Change path…' }));
    const dialog = within(await screen.findByRole('dialog'));
    const input = dialog.getByLabelText('New path') as HTMLInputElement;
    expect(input.value).toBe('~/old/app');
    expect(
      (dialog.getByRole('button', { name: 'Change path' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(input, { target: { value: '/home/me/code' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Browse…' }));
    const browser = within(
      await waitFor(() => {
        const found = document.querySelector('[data-directory-dialog]');
        if (!found) throw new Error('no browser');
        return found as HTMLElement;
      }),
    );
    fireEvent.click(await browser.findByRole('button', { name: /app/ }));
    await waitFor(() =>
      expect((browser.getByLabelText('Path') as HTMLInputElement).value).toBe('~/code/app'),
    );
    fireEvent.click(browser.getByRole('button', { name: 'Choose this folder' }));
    await waitFor(() => expect(input.value).toBe('~/code/app'));
    fireEvent.click(dialog.getByRole('button', { name: 'Change path' }));
    await waitFor(() => expect(moveRepository).toHaveBeenCalledWith(APP, '~/code/app'));
  });

  it('opens the project settings of a project as the repository of the panel', async () => {
    await show([repositoryView(APP), repositoryView(LIB)], '#settings/global/projects/lib');
    const form = within(await projectForm('lib'));
    fireEvent.click(form.getByRole('button', { name: 'Project settings' }));
    await waitFor(() => expect(window.location.hash).toBe('#settings/project/general'));
    await waitFor(() =>
      expect(document.querySelector('[data-repository-trigger]')?.getAttribute('aria-label')).toBe(
        'Repository: lib',
      ),
    );
  });

  it('removes a project after confirmation; a refusal leaves it', async () => {
    const removeRepository = vi
      .fn<Api['removeRepository']>()
      .mockRejectedValueOnce(new ApiError(400, 'repository has unfinished runs: 1'))
      .mockResolvedValueOnce([repositoryView(APP)]);
    await show([repositoryView(APP), repositoryView(LIB)], '#settings/global/projects/lib', {
      removeRepository,
    });
    const remove = async () => {
      const form = within(await projectForm('lib'));
      fireEvent.click(form.getByRole('button', { name: 'Remove from list' }));
      const dialog = within(await screen.findByRole('alertdialog'));
      fireEvent.click(dialog.getByRole('button', { name: 'Remove from list' }));
    };
    await remove();
    await waitFor(() => expect(removeRepository).toHaveBeenCalledTimes(1));
    expect(await projectForm('lib')).toBeTruthy();
    await remove();
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/projects'));
  });

  const headerLabel = () =>
    document.querySelector('[data-repository-trigger]')?.getAttribute('aria-label');
  const selectLib = async () => {
    const trigger = document.querySelector<HTMLElement>('[data-repository-trigger]')!;
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /lib/ }));
    await waitFor(() => expect(headerLabel()).toBe('Repository: lib'));
  };
  const confirmRemoval = async () => {
    const form = within(await projectForm('lib'));
    fireEvent.click(form.getByRole('button', { name: 'Remove from list' }));
    return within(await screen.findByRole('alertdialog'));
  };

  it('removing the selected project selects the first one and forgets the choice', async () => {
    const removeRepository = vi.fn<Api['removeRepository']>(async () => [repositoryView(APP)]);
    await show([repositoryView(APP), repositoryView(LIB)], '#settings/global/projects/lib', {
      removeRepository,
    });
    await selectLib();
    const dialog = await confirmRemoval();
    fireEvent.click(dialog.getByRole('button', { name: 'Remove from list' }));
    await waitFor(() => expect(removeRepository).toHaveBeenCalledWith(LIB));
    await waitFor(() => expect(headerLabel()).toBe('Repository: app'));
    expect(window.localStorage.getItem('aip.web.repository')).toBe('null');
  });

  it('cancelling the removal sends nothing and keeps the selection', async () => {
    const removeRepository = vi.fn<Api['removeRepository']>(async () => [repositoryView(APP)]);
    await show([repositoryView(APP), repositoryView(LIB)], '#settings/global/projects/lib', {
      removeRepository,
    });
    await selectLib();
    const dialog = await confirmRemoval();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(removeRepository).not.toHaveBeenCalled();
    expect(headerLabel()).toBe('Repository: lib');
  });

  it('a removed project that returns to the registry is not selected again', async () => {
    const removeRepository = vi.fn<Api['removeRepository']>(async () => [repositoryView(APP)]);
    await show([repositoryView(APP), repositoryView(LIB)], '#settings/global/projects/lib', {
      removeRepository,
    });
    await selectLib();
    const dialog = await confirmRemoval();
    fireEvent.click(dialog.getByRole('button', { name: 'Remove from list' }));
    await waitFor(() => expect(headerLabel()).toBe('Repository: app'));
    act(() =>
      FakeEventSource.last?.send({
        event: 'repositories',
        seq: 9,
        repositories: [repositoryView(APP), repositoryView(LIB)],
      }),
    );
    expect(headerLabel()).toBe('Repository: app');
    expect(window.localStorage.getItem('aip.web.repository')).toBe('null');
  });
});

describe('disabled projects in the panel', () => {
  it('leaves a disabled project out of the menu and explains an empty project tab', async () => {
    await show([repositoryView(APP, { enabled: false })], '#settings/project/general');
    const link = await screen.findByRole('link', { name: 'Projects' });
    expect(link.closest('p')?.textContent).toMatch(/^No enabled projects/);
    expect(screen.getByRole('link', { name: 'Projects' }).getAttribute('href')).toBe(
      '#settings/global/projects',
    );
  });

  it('names a project by its name with its color in the menu and links to the projects', async () => {
    await show(
      [
        repositoryView(APP, { name: 'Магазин', label: 'Магазин', color: 'teal' }),
        repositoryView(LIB, { enabled: false }),
      ],
      '#queue',
    );
    const trigger = () => document.querySelector<HTMLElement>('[data-repository-trigger]')!;
    await waitFor(() => expect(trigger().getAttribute('aria-label')).toBe('Repository: Магазин'));
    expect(trigger().querySelector('[data-project-color="teal"]')).toBeTruthy();
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    await screen.findByRole('menuitemradio', { name: /Магазин/ });
    expect(screen.queryByRole('menuitemradio', { name: /lib/ })).toBeNull();
    expect(document.querySelector('[data-projects-link]')?.getAttribute('href')).toBe(
      '#settings/global/projects',
    );
  });
});
