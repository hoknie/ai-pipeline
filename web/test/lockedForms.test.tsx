// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorChain } from '../src/shared/api/types.ts';
import { ChainForm } from '../src/features/specialists/chains/ChainForm.tsx';
import { SpecialistForm } from '../src/features/specialists/form/SpecialistForm.tsx';
import { configView, fakeApi, specialistEntry } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(cleanup);

const WRITES = [/^Save/, /^Save as/, /^Override/, /^Make shared/, /^Remove$/, /^Delete$/, /^Reset/];
const fields = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea, select'));

function specialistForm(
  level: 'project' | 'global',
  locked?: boolean,
  overrides: Parameters<typeof specialistEntry>[1] = {},
) {
  const api = fakeApi();
  render(
    <SpecialistForm
      api={api}
      view={configView({})}
      specialist={specialistEntry('qa', {
        level,
        file: '/x/qa.yaml',
        revision: 'r1',
        ...overrides,
      })}
      catalog={null}
      catalogError={null}
      notice={null}
      onDirty={vi.fn()}
      onReload={vi.fn(async () => undefined)}
      onSaved={vi.fn(async () => undefined)}
      onDeleted={vi.fn(async () => undefined)}
      {...(locked === undefined ? {} : { locked })}
    />,
  );
  return api;
}

describe('the form of a specialist with locked', () => {
  it.each(['project', 'global'] as const)('is view only for a %s specialist', (level) => {
    specialistForm(level, true);
    expect(fields().length).toBeGreaterThan(0);
    expect(
      fields()
        .filter((field) => !field.disabled)
        .map((f) => f.outerHTML),
    ).toEqual([]);
    for (const name of WRITES) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByText(/it is view only/)).toBeNull();
  });

  it('keeps the level switch working: another file, still disabled, no writes', async () => {
    const api = specialistForm('project', true, {
      sources: {
        project: { file: '/x/qa.yaml', revision: 'r1', raw: { name: 'Project QA' } },
        global: { file: '/g/qa.yaml', revision: 'r2', raw: { name: 'Global QA' } },
      },
    });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Project QA');
    expect(screen.getByText('/x/qa.yaml')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Global QA'),
    );
    expect(screen.getByText('/g/qa.yaml')).toBeTruthy();
    expect(fields().filter((field) => !field.disabled)).toEqual([]);
    expect(api.writeSpecialist).not.toHaveBeenCalled();
    expect(api.deleteSpecialist).not.toHaveBeenCalled();
  });

  it('stays editable without locked', () => {
    specialistForm('project');
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

const raw = { name: 'Fast', mode: 'on_error', enabled: true, runtimes: [{ provider: 'zai' }] };
const chain = (level: 'project' | 'global'): EditorChain => ({
  slug: 'fast',
  level,
  file: '/x/fast.yaml',
  revision: level === 'project' ? 'c1' : null,
  raw,
  sources: { [level]: { file: '/x/fast.yaml', revision: 'c1', raw } },
});

function chainForm(level: 'project' | 'global', locked?: boolean) {
  render(
    <ChainForm
      api={fakeApi()}
      chain={chain(level)}
      onDirty={vi.fn()}
      onSaved={vi.fn(async () => undefined)}
      onDeleted={vi.fn(async () => undefined)}
      {...(locked === undefined ? {} : { locked })}
    />,
  );
}

describe('the form of a chain with locked', () => {
  it.each(['project', 'global'] as const)('is view only for a %s chain', (level) => {
    chainForm(level, true);
    expect(fields().length).toBeGreaterThan(0);
    expect(
      fields()
        .filter((field) => !field.disabled)
        .map((f) => f.outerHTML),
    ).toEqual([]);
    for (const name of WRITES) expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('shows no global hint for a project chain', () => {
    chainForm('project', true);
    expect(screen.queryByText(/global file applies/i)).toBeNull();
  });

  it('stays editable without locked', () => {
    chainForm('project');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
