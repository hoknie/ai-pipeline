// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/shared/api/api.ts';
import PipelinesPage from '../src/features/pipelines/PipelinesPage.tsx';
import type { EditorPipeline } from '../src/shared/api/types.ts';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, repositoryView, sourcesFor, specialistEntry } from './fixtures.ts';

vi.mock('../src/features/topology/PipelineGraph.tsx', () => ({
  PipelineGraph: () => <div data-testid="graph" />,
}));

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Page({ api }: { api: Api }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <PipelinesPage api={api} runs={[]} selected={selected} onSelect={setSelected} />;
}

function entry(
  id: string,
  overrides: Partial<EditorPipeline> & { name?: string } = {},
): EditorPipeline {
  const { name, ...rest } = overrides;
  const base = {
    id,
    level: 'project' as const,
    file: `/repo/aip/pipelines/${id}.yaml`,
    revision: `rev-${id}`,
    raw: { ...(name ? { name } : {}), steps: [{ id: 'code', specialist: 'coder' }] },
    shared_tags: [] as string[],
    own_tags: [] as string[],
    ...rest,
  };
  return { ...base, sources: rest.sources ?? sourcesFor('pipelines', base) };
}

const specialists = [specialistEntry('coder')];

/** Own pipelines for the repository of the page, the source's for `/work/lib`. */
function importApi(overrides: Partial<Api> = {}) {
  const own = configView({ specialists, pipelines: [entry('feature')] });
  const lib = configView({
    repository: '/work/lib',
    specialists,
    pipelines: [
      entry('feature', { name: 'Feature of lib' }),
      entry('release', { name: 'Release', own_tags: ['ship'] }),
      entry('quick', { level: 'global', file: '/xdg/aip/pipelines/quick.yaml' }),
    ],
  });
  const api: Api & { calls: [string, string | null][] } = fakeApi({
    repositories: vi.fn(async () => [repositoryView('/repo'), repositoryView('/work/lib')]),
    config: vi.fn(async () => (api.calls.at(-1)?.[1] === '/work/lib' ? lib : own)),
    ...overrides,
  });
  return api;
}

const open = async (api: Api) => {
  render(<Page api={api} />);
  await screen.findByRole('list', { name: 'pipeline' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  return screen.findByRole('dialog');
};

describe('pipeline import', () => {
  it('lists the project pipelines of another repository with their tags and blocks taken ids', async () => {
    const dialog = await open(importApi());
    const list = await within(dialog).findByRole('list', { name: 'pipelines of the source' });
    // a shared pipeline of the source is not offered
    expect(within(list).queryByRole('checkbox', { name: /quick/ })).toBeNull();
    expect(
      within(list)
        .getByRole('checkbox', { name: /Feature of lib/ })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(within(list).getByText(/already in this project/)).toBeTruthy();
    expect(within(list).getByText('ship')).toBeTruthy();
    expect(
      within(list)
        .getByRole('checkbox', { name: /Release/ })
        .hasAttribute('disabled'),
    ).toBe(false);
    expect(within(dialog).getByText(/Specialists are not copied/)).toBeTruthy();
    // the repository of the page is not a source
    expect(
      within(dialog).getByRole('combobox', { name: 'Source repository' }).textContent,
    ).toContain('lib');
  });

  it('sends one request with the chosen ids and reports the count', async () => {
    const importPipelines = vi.fn(async (_source: string, ids: string[]) => ({
      ok: true as const,
      imported: ids,
    }));
    const api = importApi({ importPipelines });
    const dialog = await open(api);
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Release/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import selected: 1' }));
    await waitFor(() => expect(importPipelines).toHaveBeenCalledTimes(1));
    expect(importPipelines).toHaveBeenCalledWith('/work/lib', ['release']);
    expect(await screen.findByText('Pipelines imported: 1')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog and the marks on a conflict', async () => {
    const importPipelines = vi.fn(async () => ({
      ok: false as const,
      reason: 'conflict' as const,
      message: 'already defined in the project: release',
    }));
    const dialog = await open(importApi({ importPipelines }));
    const release = await within(dialog).findByRole('checkbox', { name: /Release/ });
    fireEvent.click(release);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import selected: 1' }));
    expect(await within(dialog).findByText(/already defined in the project/)).toBeTruthy();
    expect(release.getAttribute('data-state')).toBe('checked');
  });

  it('shows the errors of the configuration, such as a missing specialist', async () => {
    const importPipelines = vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [
        {
          path: 'swarm.pipelines.release.steps[0].specialist',
          message: 'unknown specialist `writer`',
        },
      ],
    }));
    const dialog = await open(importApi({ importPipelines }));
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Release/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import selected: 1' }));
    expect(
      await within(dialog).findByText('swarm.pipelines.release.steps[0].specialist'),
    ).toBeTruthy();
    expect(within(dialog).getByText(/unknown specialist/)).toBeTruthy();
  });

  it('explains that there is no other repository', async () => {
    const dialog = await open(
      importApi({ repositories: vi.fn(async () => [repositoryView('/repo')]) }),
    );
    expect(await within(dialog).findByText(/no other repositories/)).toBeTruthy();
  });
});
