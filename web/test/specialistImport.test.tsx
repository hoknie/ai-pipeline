// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/shared/api/api.ts';
import SpecialistsPage from '../src/features/specialists/SpecialistsPage.tsx';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, specialistEntry, tagFolder } from './fixtures.ts';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Page({ api }: { api: Api }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <SpecialistsPage api={api} selected={selected} onSelect={setSelected} />;
}

const folders = () => ({
  folders: [
    tagFolder(null, [{ slug: 'qa', tags: ['review'] }]),
    tagFolder('/repo', [{ slug: 'coder' }]),
    tagFolder('/work/lib', [
      { slug: 'coder', tags: ['backend'] },
      { slug: 'plan', name: 'Planner', tags: ['fast'] },
      { slug: 'bad', error: 'syntax error' },
    ]),
  ],
});

const open = async (api: Api) => {
  render(<Page api={api} />);
  await screen.findByRole('list', { name: 'specialists' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  return screen.findByRole('dialog');
};

describe('specialist import', () => {
  it('lists the specialists of another repository with their tags and blocks taken slugs', async () => {
    const api = fakeApi({
      specialistTags: vi.fn(async () => folders()),
      config: vi.fn(async () =>
        configView({ specialists: [specialistEntry('coder', { level: 'project' })] }),
      ),
    });
    const dialog = await open(api);
    const list = await within(dialog).findByRole('list', { name: 'specialists of the source' });
    const coder = within(list).getByRole('checkbox', { name: /CODER/ });
    expect(coder.hasAttribute('disabled')).toBe(true);
    expect(within(list).getByText(/already in this project/)).toBeTruthy();
    expect(within(list).getByText('backend')).toBeTruthy();
    expect(within(list).getByRole('checkbox', { name: /BAD/ }).hasAttribute('disabled')).toBe(true);
    expect(
      within(list)
        .getByRole('checkbox', { name: /Planner/ })
        .hasAttribute('disabled'),
    ).toBe(false);
    // the repository of the page is not a source
    expect(
      within(dialog).getByRole('combobox', { name: 'Source repository' }).textContent,
    ).toContain('lib');
  });

  it('sends one request with the chosen slugs and reports the count', async () => {
    const importSpecialists = vi.fn(async (_source: string, slugs: string[]) => ({
      ok: true as const,
      imported: slugs,
    }));
    const config = vi.fn(async () => configView({ specialists: [] }));
    const api = fakeApi({
      importSpecialists,
      config,
      specialistTags: vi.fn(async () => folders()),
    });
    const dialog = await open(api);
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Planner/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /CODER/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import selected: 2' }));
    await waitFor(() => expect(importSpecialists).toHaveBeenCalledTimes(1));
    expect(importSpecialists).toHaveBeenCalledWith('/work/lib', ['plan', 'coder']);
    expect(await screen.findByText('Specialists imported: 2')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(config.mock.calls.length).toBeGreaterThan(1));
  });

  it('keeps the dialog and the marks on a conflict', async () => {
    const importSpecialists = vi.fn(async () => ({
      ok: false as const,
      reason: 'conflict' as const,
      message: 'already defined in the project: coder',
    }));
    const api = fakeApi({
      importSpecialists,
      specialistTags: vi.fn(async () => folders()),
      config: vi.fn(async () => configView({ specialists: [] })),
    });
    const dialog = await open(api);
    const plan = await within(dialog).findByRole('checkbox', { name: /Planner/ });
    fireEvent.click(plan);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import selected: 1' }));
    expect(await within(dialog).findByText(/already defined in the project/)).toBeTruthy();
    expect(plan.getAttribute('data-state')).toBe('checked');
  });

  it('shows the errors of the configuration', async () => {
    const importSpecialists = vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [{ path: 'swarm.specialists.plan.runtime', message: 'must be one of claude' }],
    }));
    const api = fakeApi({
      importSpecialists,
      specialistTags: vi.fn(async () => folders()),
      config: vi.fn(async () => configView({ specialists: [] })),
    });
    const dialog = await open(api);
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Planner/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import selected: 1' }));
    expect(await within(dialog).findByText('swarm.specialists.plan.runtime')).toBeTruthy();
  });

  it('explains that there is no other repository', async () => {
    const api = fakeApi({
      specialistTags: vi.fn(async () => ({
        folders: [tagFolder(null, []), tagFolder('/repo', [])],
      })),
    });
    const dialog = await open(api);
    expect(await within(dialog).findByText(/no other repositories/)).toBeTruthy();
  });
});
