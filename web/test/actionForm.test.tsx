// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/api.ts';
import { draftOfAction, valueOfAction } from '../src/components/ActionForm.tsx';
import PipelinesPage from '../src/components/PipelinesPage.tsx';

import { choose, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { actionEntry, configView, fakeApi, specialistEntry } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const specialists = ['coder', 'writer'].map((slug) => specialistEntry(slug));
const commit = actionEntry('commit', { name: 'Commit', run: 'git commit -am x', timeout: 60 });
const review = actionEntry('review', { specialist: 'writer', additional_prompt: 'Be brief' });

function api(overrides: Partial<Api> = {}): Api {
  return fakeApi({
    config: vi.fn(async () =>
      configView({ specialists, actions: [commit, review], pipelines: [] }),
    ),
    ...overrides,
  });
}

function Page({ api, start }: { api: Api; start: string }) {
  const [selected, setSelected] = useState<string | null>(start);
  return (
    <PipelinesPage
      api={api}
      runs={[]}
      selected={selected}
      section="actions"
      onSelect={(id) => setSelected(id)}
    />
  );
}

const saved = () => vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
const lastValue = (mock: ReturnType<typeof saved>, call = 0) =>
  mock.mock.calls[call] as unknown as [string, Record<string, unknown>, string | null, string];

describe('the draft of an action', () => {
  it('reads and writes the fields of the chosen type only', () => {
    expect(
      valueOfAction(draftOfAction({ run: 'make', timeout: 30, on_failure: 'continue' })),
    ).toEqual({
      run: 'make',
      timeout: 30,
      on_failure: 'continue',
    });
    const draft = draftOfAction({ specialist: 'coder', additional_prompt: 'x' });
    expect(draft.kind).toBe('specialist');
    expect(valueOfAction({ ...draft, kind: 'command', run: 'make' })).toEqual({ run: 'make' });
    expect(valueOfAction({ ...draft, kind: 'specialist' })).toEqual({
      specialist: 'coder',
      additional_prompt: 'x',
    });
  });
});

describe('the form of an action', () => {
  it('creates a command action on the chosen level', async () => {
    const writeAction = saved();
    render(<Page api={api({ writeAction })} start="new" />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Global' }));
    fireEvent.change(await screen.findByLabelText('Id'), { target: { value: 'lint' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lint' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npm run lint' } });
    fireEvent.change(screen.getByLabelText('Timeout, seconds'), { target: { value: '120' } });
    choose(screen.getByRole('combobox', { name: 'on failure' }), 'Continue');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeAction).toHaveBeenCalled());
    expect(lastValue(writeAction)).toEqual([
      'lint',
      { name: 'Lint', run: 'npm run lint', timeout: 120, on_failure: 'continue' },
      null,
      'global',
    ]);
  });

  it('creates a specialist action in the project', async () => {
    const writeAction = saved();
    render(<Page api={api({ writeAction })} start="new" />);
    fireEvent.change(await screen.findByLabelText('Id'), { target: { value: 'notify' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Specialist' }));
    expect(screen.queryByLabelText('Command')).toBeNull();
    choose(screen.getByRole('combobox', { name: 'action specialist' }), 'writer');
    fireEvent.change(screen.getByLabelText('Additional prompt'), { target: { value: 'Short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeAction).toHaveBeenCalled());
    expect(lastValue(writeAction)).toEqual([
      'notify',
      { specialist: 'writer', additional_prompt: 'Short' },
      null,
      'project',
    ]);
  });

  it('shows the error of a field at the field, with the path of the rest in a list', async () => {
    const writeAction = vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [
        { path: 'swarm.actions.commit.timeout', message: 'must be an integer from 1 to 86400' },
        { path: 'swarm.actions.commit', message: 'sets both run and specialist' },
      ],
    }));
    render(<Page api={api({ writeAction })} start="commit" />);
    fireEvent.change(await screen.findByLabelText('Timeout, seconds'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByText('must be an integer from 1 to 86400');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(screen.getByLabelText('Timeout, seconds').parentElement!.contains(alert)).toBe(true);
    expect(screen.getByText('swarm.actions.commit').tagName).toBe('CODE');
  });

  it('writes to the revision of the opened file', async () => {
    const writeAction = saved();
    render(<Page api={api({ writeAction })} start="commit" />);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Commit!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeAction).toHaveBeenCalled());
    expect(lastValue(writeAction)).toEqual([
      'commit',
      { name: 'Commit!', run: 'git commit -am x', timeout: 60 },
      'rev-commit',
      'project',
    ]);
  });

  it('refuses to delete an action that a point still names and lists the places', async () => {
    const deleteAction = vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [{ path: 'swarm.actions.commit', message: 'the action is used' }],
      references: [{ point: 'after_delivery' }, { pipeline: 'feature', point: 'before_delivery' }],
    }));
    render(<Page api={api({ deleteAction })} start="commit" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(deleteAction).toHaveBeenCalledWith('commit', 'rev-commit', 'project'),
    );
    const places = await screen.findByTestId('action-references');
    expect(
      within(places)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['swarm.stages.after_delivery', 'feature → stages.before_delivery']);
    expect(screen.getByText(/the action is used/)).toBeTruthy();
  });

  it('deletes a free action', async () => {
    const deleteAction = vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' }));
    render(<Page api={api({ deleteAction })} start="review" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(deleteAction).toHaveBeenCalledWith('review', 'rev-review', 'project'),
    );
  });
});
