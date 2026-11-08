// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SpecialistsPage from '../src/features/specialists/SpecialistsPage.tsx';
import type { ConfigEditResult } from '../src/shared/api/types.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { catalogView, configView, fakeApi, settingsOf, specialistEntry } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => cleanup());

async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(await screen.findByRole('combobox', { name: label }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

function open(raw: Record<string, unknown>, defaultRuntime = 'claude', catalog = catalogView()) {
  let current = raw;
  const config = vi.fn(async () =>
    configView({
      specialists: [
        specialistEntry(
          'coder',
          { raw: current },
          { runtime: String(current.runtime ?? defaultRuntime) },
        ),
      ],
      settings: settingsOf({
        'defaults.runtime': { path: 'defaults.runtime', value: defaultRuntime, file: null },
      }),
    }),
  );
  const writeSpecialist = vi.fn(
    async (_id: string, value: Record<string, unknown>): Promise<ConfigEditResult> => {
      current = value;
      return { ok: true as const, revision: 'next', file: '/repo/aip/specialists/coder.yaml' };
    },
  );
  const api = fakeApi({ config, writeSpecialist, catalog: vi.fn(async () => catalog) });
  render(<SpecialistsPage api={api} selected="coder" onSelect={vi.fn()} />);
  return { api, config, writeSpecialist };
}

describe('OpenCode model options in the specialist form', () => {
  it.each([
    [{ name: 'Coder', runtime: 'opencode' }, 'claude'],
    [{ name: 'Coder' }, 'opencode'],
  ] as const)('shows options for the resolved runtime: %j', async (raw, defaultRuntime) => {
    open(raw, defaultRuntime);
    expect(await screen.findByLabelText('Variant')).toBeTruthy();
    const effort = await screen.findByRole('combobox', { name: 'Reasoning effort' });
    expect(effort.textContent).toBe('OpenCode default');
    fireEvent.keyDown(effort, { key: 'Enter' });
    for (const option of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(screen.getByRole('option', { name: option })).toBeTruthy();
    }
  });

  it('hides empty OpenCode options for Claude', async () => {
    open({ name: 'Coder', runtime: 'claude' });
    await screen.findByLabelText('Model');
    expect(screen.queryByLabelText('Variant')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull();
  });

  it('saves a custom variant and effort, explains precedence and reloads both', async () => {
    const { writeSpecialist, config } = open({ name: 'Coder', runtime: 'opencode' });
    fireEvent.change(await screen.findByLabelText('Variant'), {
      target: { value: 'company-deep' },
    });
    await choose('Reasoning effort', 'xhigh');
    expect(
      screen.getByText('The selected variant takes precedence if it sets reasoningEffort.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writeSpecialist).toHaveBeenCalledWith(
        'coder',
        {
          name: 'Coder',
          runtime: 'opencode',
          variant: 'company-deep',
          reasoning_effort: 'xhigh',
        },
        'rev-coder',
        'project',
      ),
    );
    await waitFor(() => expect(config).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText('Variant') as HTMLInputElement).value).toBe('company-deep');
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' }).textContent).toBe('xhigh');
  });

  it('removes both cleared keys instead of setting a default effort', async () => {
    const { writeSpecialist } = open({
      name: 'Coder',
      runtime: 'opencode',
      variant: 'deep',
      reasoning_effort: 'high',
    });
    fireEvent.change(await screen.findByLabelText('Variant'), { target: { value: '' } });
    await choose('Reasoning effort', 'OpenCode default');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writeSpecialist).toHaveBeenCalledWith(
        'coder',
        {
          name: 'Coder',
          runtime: 'opencode',
        },
        'rev-coder',
        'project',
      ),
    );
  });

  it('keeps incompatible values visible and shows validation errors at their fields', async () => {
    const { writeSpecialist } = open({
      name: 'Coder',
      runtime: 'opencode',
      variant: 'deep',
      reasoning_effort: 'high',
    });
    writeSpecialist.mockImplementation(async () => ({
      ok: false,
      reason: 'invalid',
      errors: [
        {
          path: 'swarm.specialists.coder.variant',
          message: 'is supported by the opencode runtime only',
        },
      ],
    }));
    await choose('Runtime', 'claude');
    expect((screen.getByLabelText('Variant') as HTMLInputElement).value).toBe('deep');
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' }).textContent).toBe('high');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const field = screen.getByLabelText('Variant').closest('div')!;
    expect((await within(field).findByRole('alert')).textContent).toContain(
      'opencode runtime only',
    );
    expect((screen.getByLabelText('Variant') as HTMLInputElement).value).toBe('deep');
  });

  it('offers agy skills and keeps OpenCode-only draft values visible for validation', async () => {
    const writeSpecialist = vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [
        {
          path: 'swarm.specialists.coder.reasoning_effort',
          message: 'is supported by the opencode runtime only',
        },
      ],
    }));
    const catalog = catalogView({
      runtimes: {
        claude: catalogView().runtimes.claude,
        opencode: catalogView().runtimes.opencode,
        agy: { tools: [], skills: [{ name: 'review', source: 'project' }] },
      },
    });
    const openPage = open(
      { name: 'Coder', runtime: 'opencode', variant: 'deep', reasoning_effort: 'high' },
      'claude',
      catalog,
    );
    openPage.writeSpecialist.mockImplementation(writeSpecialist);
    await choose('Runtime', 'agy');
    expect((screen.getByLabelText('Variant') as HTMLInputElement).value).toBe('deep');
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' }).textContent).toBe('high');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('is supported by the opencode runtime only')).toBeTruthy();
    expect((screen.getByLabelText('Variant') as HTMLInputElement).value).toBe('deep');
  });

  it('preserves both options when saving under a new slug', async () => {
    const { writeSpecialist } = open({
      name: 'Coder',
      runtime: 'opencode',
      variant: 'deep',
      reasoning_effort: 'high',
    });
    await screen.findByLabelText('Variant');
    fireEvent.click(screen.getByRole('button', { name: 'Save as…' }));
    fireEvent.change(screen.getByLabelText('New slug'), { target: { value: 'coder-deep' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create a copy' }));
    await waitFor(() =>
      expect(writeSpecialist).toHaveBeenCalledWith(
        'coder-deep',
        {
          name: 'Coder',
          runtime: 'opencode',
          variant: 'deep',
          reasoning_effort: 'high',
        },
        null,
        'project',
      ),
    );
  });

  it('loads options from the selected source level', async () => {
    const project = {
      file: '/repo/aip/specialists/coder.yaml',
      revision: 'own',
      raw: { name: 'Own', runtime: 'opencode', reasoning_effort: 'xhigh' },
    };
    const global = {
      file: '/xdg/aip/specialists/coder.yaml',
      revision: 'shared',
      raw: { name: 'Shared', runtime: 'opencode', variant: 'deep', reasoning_effort: 'low' },
    };
    const api = fakeApi({
      config: vi.fn(async () =>
        configView({
          specialists: [
            specialistEntry('coder', {
              level: 'project_over_global',
              raw: project.raw,
              revision: project.revision,
              sources: { project, global },
            }),
          ],
        }),
      ),
    });
    render(<SpecialistsPage api={api} selected="coder" onSelect={vi.fn()} />);
    expect(((await screen.findByLabelText('Variant')) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' }).textContent).toBe('xhigh');
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Variant') as HTMLInputElement).value).toBe('deep'),
    );
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' }).textContent).toBe('low');
  });
});
