// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/shared/api/api.ts';
import PipelinesPage from '../src/features/pipelines/PipelinesPage.tsx';
import type { EditorPipeline } from '../src/shared/api/types.ts';

import { choose, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { actionEntry, configView, fakeApi, sourcesFor, specialistEntry } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const specialists = [
  specialistEntry('coder', {}, { name: 'Кодировщик' }),
  specialistEntry('reviewer', {}, { name: 'Ревьюер' }),
  specialistEntry('local-only', { sources: undefined }, { name: 'Локальный' }),
];

function pipeline(id: string, raw: Record<string, unknown>): EditorPipeline {
  const base = {
    id,
    level: 'project' as const,
    file: `/repo/aip/pipelines/${id}.yaml`,
    revision: `rev-${id}`,
    raw,
    shared_tags: [] as string[],
    own_tags: [] as string[],
  };
  return { ...base, sources: sourcesFor('pipelines', base) };
}

const saved = () => vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));

function api(pipelines: EditorPipeline[], overrides: Partial<Api> = {}): Api {
  return fakeApi({
    config: vi.fn(async () =>
      configView({
        specialists,
        pipelines,
        actions: [actionEntry('review', { specialist: 'reviewer' })],
      }),
    ),
    writePipeline: saved(),
    ...overrides,
  });
}

function Page({ api, start, section }: { api: Api; start: string; section?: 'actions' }) {
  const [selected, setSelected] = useState<string | null>(start);
  return (
    <PipelinesPage
      api={api}
      runs={[]}
      selected={selected}
      section={section}
      onSelect={setSelected}
    />
  );
}

const stepBox = async (index: number) =>
  (await screen.findAllByRole('listitem', { name: /^step \d+$/ }))[index]!;

describe('specialists of the pipeline editor are shown by name', () => {
  const raw = { steps: [{ id: 'review', specialist: 'reviewer' }] };

  it('labels the list and the closed select of a step with the name', async () => {
    render(<Page api={api([pipeline('feature', raw)])} start="feature" />);
    const select = within(await stepBox(0)).getByRole('combobox', { name: 'step specialist' });
    expect(select.textContent).toContain('Ревьюер');
    expect(select.textContent).not.toContain('reviewer');
    fireEvent.keyDown(select, { key: 'Enter' });
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      '—',
      'Кодировщик',
      'Ревьюер',
      'Локальный',
    ]);
  });

  it('writes the slug when a step is chosen by name', async () => {
    const writePipeline = saved();
    render(<Page api={api([pipeline('feature', raw)], { writePipeline })} start="feature" />);
    choose(
      within(await stepBox(0)).getByRole('combobox', { name: 'step specialist' }),
      'Кодировщик',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    const [, value] = writePipeline.mock.calls[0] as unknown as [
      string,
      { steps: { specialist: string }[] },
    ];
    expect(value.steps[0]?.specialist).toBe('coder');
  });

  it('keeps a specialist of the file that the configuration does not know', async () => {
    const writePipeline = saved();
    const ghost = { steps: [{ id: 'ghost', specialist: 'ghost' }] };
    render(<Page api={api([pipeline('feature', ghost)], { writePipeline })} start="feature" />);
    const select = within(await stepBox(0)).getByRole('combobox', { name: 'step specialist' });
    expect(select.textContent).toContain('ghost');
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Feature' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    const [, value] = writePipeline.mock.calls[0] as unknown as [
      string,
      { steps: { specialist: string }[] },
    ];
    expect(value.steps[0]?.specialist).toBe('ghost');
  });

  it('labels the specialist of the split with the name', async () => {
    const epic = { split: { specialist: 'reviewer' }, steps: [{ id: 'a', specialist: 'coder' }] };
    render(<Page api={api([pipeline('epic', epic)])} start="epic" />);
    const select = await screen.findByRole('combobox', { name: 'split specialist' });
    expect(select.textContent).toContain('Ревьюер');
  });

  it('labels the specialist of an action with the name and writes the slug', async () => {
    const writeAction = saved();
    render(<Page api={api([], { writeAction })} start="review" section="actions" />);
    const select = await screen.findByRole('combobox', { name: 'action specialist' });
    expect(select.textContent).toContain('Ревьюер');
    choose(select, 'Кодировщик');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeAction).toHaveBeenCalled());
    const call = writeAction.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[1]).toMatchObject({ specialist: 'coder' });
  });
});
