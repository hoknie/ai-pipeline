// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/shared/api/api.ts';
import SpecialistsPage from '../src/features/specialists/SpecialistsPage.tsx';
import { RunSummary } from '../src/features/runs/header/RunSummary.tsx';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';
import { configView, fakeApi, runView, specialistEntry } from './fixtures.ts';

afterEach(cleanup);

function Page({ api, start }: { api: Api; start: string }) {
  const [selected, setSelected] = useState<string | null>(start);
  return <SpecialistsPage api={api} selected={selected} onSelect={setSelected} />;
}

const reviewer = () =>
  configView({
    specialists: [specialistEntry('reviewer', { raw: { name: 'Reviewer' } })],
  });

const skills = [
  {
    id: 'sk-1',
    name: 'go-testing',
    title: 'Go testing',
    description: '',
    tags: [],
    versions: ['1.4.1', '1.2.0'],
  },
  {
    id: 'sk-2',
    name: 'sql-review',
    title: 'sql-review',
    description: '',
    tags: [],
    versions: ['2.0.0'],
  },
];

describe('registry skills in the form of a specialist', () => {
  const open = async () => {
    fireEvent.click(await screen.findByRole('combobox', { name: 'Skills' }));
    return screen.findByRole('combobox', { name: /Search in Skills/ });
  };

  it('offers registry:<name> with the latest version and saves the chosen reference', async () => {
    const registrySkills = vi.fn(async () => skills);
    const writeSpecialist = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'n',
      file: '/f',
    }));
    render(
      <Page
        api={fakeApi({ registrySkills, writeSpecialist, config: vi.fn(async () => reviewer()) })}
        start="reviewer"
      />,
    );
    const search = await open();
    await waitFor(() => expect(registrySkills).toHaveBeenCalled());
    fireEvent.change(search, { target: { value: 'go' } });
    const option = await screen.findByRole('option', { name: /registry:go-testing/ });
    expect(option.textContent).toContain('latest 1.4.1');
    expect(screen.getByText('Skills of the registry')).toBeTruthy();
    fireEvent.click(option);
    expect(screen.getByRole('button', { name: 'Remove registry:go-testing' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist.mock.calls[0]?.[1]).toEqual({
      name: 'Reviewer',
      skills: ['registry:go-testing'],
    });
  });

  it('does not mark a registry reference as missing and works without a registry', async () => {
    const registrySkills = vi.fn(async () => {
      throw new Error('no connection');
    });
    render(
      <Page
        api={fakeApi({
          registrySkills,
          config: vi.fn(async () =>
            configView({
              specialists: [
                specialistEntry('reviewer', {
                  raw: { name: 'Reviewer', skills: ['registry:go-testing@^1'] },
                }),
              ],
            }),
          ),
        })}
        start="reviewer"
      />,
    );
    expect(
      await screen.findByRole('button', { name: 'Remove registry:go-testing@^1' }),
    ).toBeTruthy();
    await waitFor(() => expect(registrySkills).toHaveBeenCalled());
    expect(screen.queryByText('not found')).toBeNull();
  });
});

describe('pinned skills on the page of a run', () => {
  it('shows the versions fixed for the run', () => {
    render(
      <RunSummary
        run={runView({
          pinnedSkills: [
            { name: 'go-testing', version: '1.4.1' },
            { name: 'sql-review', version: '2.0.0' },
          ],
        })}
        now={0}
      />,
    );
    expect(screen.getByText('Skills')).toBeTruthy();
    expect(screen.getByText('go-testing 1.4.1, sql-review 2.0.0')).toBeTruthy();
  });

  it('shows no row for a run without registry skills', () => {
    render(<RunSummary run={runView()} now={0} />);
    expect(screen.queryByText('Skills')).toBeNull();
  });
});
