// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/api.ts';
import PipelinesPage from '../src/components/PipelinesPage.tsx';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, systemStagesView } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function api(overrides: Partial<Api> = {}): Api {
  return fakeApi({
    config: vi.fn(async () => configView()),
    systemStages: vi.fn(async () => systemStagesView()),
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
      section="system"
      onSelect={(id) => setSelected(id)}
    />
  );
}

const saved = () =>
  vi.fn(async () => ({ ok: true as const, revision: 'p2', file: '/repo/aip/settings.yaml' }));

describe('the screen of a system stage', () => {
  it('shows the built-in task read only', async () => {
    render(<Page api={api()} start="resolve" />);
    const task = await screen.findByRole('textbox', { name: /built-in task/ });
    expect((task as HTMLTextAreaElement).readOnly).toBe(true);
    expect((task as HTMLTextAreaElement).value).toBe('Resolve the conflicts of {run}.');
    expect(screen.getByRole('heading', { name: 'Delivery conflict resolution' })).toBeTruthy();
  });

  it('writes the resolver prompt to the project level', async () => {
    const writeSetting = saved();
    render(<Page api={api({ writeSetting })} start="resolve" />);
    const field = await screen.findByLabelText('Additional prompt');
    fireEvent.change(field, { target: { value: 'Keep the newer file' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSetting).toHaveBeenCalled());
    expect(writeSetting).toHaveBeenCalledWith(
      'delivery.resolver_prompt',
      'Keep the newer file',
      null,
      'project',
    );
    expect(await screen.findByText(/Saved to \/repo\/aip\/settings.yaml/)).toBeTruthy();
  });

  it('writes the message prompt to the shared level with its revision', async () => {
    const writeSetting = saved();
    render(<Page api={api({ writeSetting })} start="message" />);
    fireEvent.change(await screen.findByLabelText('Additional prompt'), {
      target: { value: 'One line' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSetting).toHaveBeenCalled());
    expect(writeSetting).toHaveBeenCalledWith(
      'delivery.message_prompt',
      'One line',
      'g1',
      'global',
    );
  });

  it('removes the prompt when the field is cleared', async () => {
    const writeSetting = saved();
    const stages = systemStagesView({
      stages: systemStagesView().stages.map((stage) =>
        stage.kind === 'resolve'
          ? {
              ...stage,
              settings: [
                { path: 'delivery.resolver_prompt', value: 'Old', level: 'global' as const },
              ],
            }
          : stage,
      ),
    });
    render(
      <Page api={api({ writeSetting, systemStages: vi.fn(async () => stages) })} start="resolve" />,
    );
    const field = await screen.findByDisplayValue('Old');
    // the level starts where the value is written
    expect(screen.getByRole('radio', { name: 'Global' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.change(field, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSetting).toHaveBeenCalled());
    expect(writeSetting).toHaveBeenCalledWith('delivery.resolver_prompt', null, 'g1', 'global');
  });

  it('shows the error of a refused write', async () => {
    const writeSetting = vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [{ path: 'delivery.resolver_prompt', message: 'must be a string' }],
    }));
    render(<Page api={api({ writeSetting })} start="resolve" />);
    await screen.findByRole('textbox', { name: /built-in task/ });
    fireEvent.change(screen.getByLabelText('Additional prompt'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/must be a string/)).toBeTruthy();
  });

  it('writes the delivery settings to the chosen level', async () => {
    const writeSetting = saved();
    render(<Page api={api({ writeSetting })} start="delivery" />);
    expect(await screen.findByText('Built-in task')).toBeTruthy();
    expect(screen.getByText('This stage has no task: the system does the work.')).toBeTruthy();
    // no setting is at the project level, so the screen starts at the shared one
    const global = await screen.findByRole('radio', { name: 'Global' });
    expect(global.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Project' }));
    expect(screen.getByRole('radio', { name: 'Project' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(await screen.findByRole('switch', { name: 'Auto delivery by default' }));
    await waitFor(() => expect(writeSetting).toHaveBeenCalled());
    expect(writeSetting).toHaveBeenCalledWith('delivery.auto', false, null, 'project');
    // the rest of the settings is shown, not edited
    const keep = screen.getByText('delivery.keep').closest('div')!;
    expect(within(keep).getByText(/false/)).toBeTruthy();
  });

  it('keeps the chosen level over two writes and rereads', async () => {
    let revision: string | null = null;
    const writeSetting = vi.fn(async () => {
      revision = revision === null ? 'p2' : 'p3';
      return { ok: true as const, revision, file: '/repo/aip/settings.yaml' };
    });
    const config = vi.fn(async () =>
      configView({
        settingsFiles: {
          global: { file: '/xdg/aip/settings.yaml', revision: 'g1' },
          project: { file: '/repo/aip/settings.yaml', revision },
        },
      }),
    );
    const systemStages = vi.fn(async () => systemStagesView());
    render(<Page api={api({ writeSetting, config, systemStages })} start="delivery" />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Project' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Auto delivery by default' }));
    await waitFor(() => expect(writeSetting).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(config.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() =>
      expect(
        (screen.getByRole('switch', { name: 'Auto delivery by default' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(screen.getByRole('radio', { name: 'Project' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Auto delivery by default' }));
    await waitFor(() => expect(writeSetting).toHaveBeenCalledTimes(2));
    const calls = writeSetting.mock.calls as unknown as unknown[][];
    expect(calls.map((call) => call[3])).toEqual(['project', 'project']);
    expect(calls[0]![2]).toBeNull();
    expect(calls[1]![2]).toBe('p2');
  });

  it.each([
    ['resolve', 'delivery.resolver_prompt'],
    ['message', 'delivery.message_prompt'],
  ])('writes the %s prompt to the project when no level was touched', async (kind, path) => {
    const writeSetting = saved();
    render(<Page api={api({ writeSetting })} start={kind} />);
    await screen.findByRole('textbox', { name: /built-in task/ });
    expect(screen.getByRole('radio', { name: 'Project' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.change(screen.getByLabelText('Additional prompt'), { target: { value: 'Note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSetting).toHaveBeenCalled());
    expect(writeSetting).toHaveBeenCalledWith(path, 'Note', null, 'project');
  });

  it('returns the field to the effective value after a write to a covered level', async () => {
    const writeSetting = saved();
    const systemStages = vi.fn(async () =>
      systemStagesView({
        stages: systemStagesView().stages.map((stage) =>
          stage.kind === 'resolve'
            ? {
                ...stage,
                settings: [
                  { path: 'delivery.resolver_prompt', value: 'A', level: 'project' as const },
                ],
              }
            : stage,
        ),
      }),
    );
    render(<Page api={api({ writeSetting, systemStages })} start="resolve" />);
    await waitFor(() =>
      expect((screen.getByLabelText('Additional prompt') as HTMLTextAreaElement).value).toBe('A'),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    fireEvent.change(screen.getByLabelText('Additional prompt'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Saved to \/repo\/aip\/settings.yaml/)).toBeTruthy();
    expect(writeSetting).toHaveBeenCalledWith('delivery.resolver_prompt', 'B', 'g1', 'global');
    await waitFor(() =>
      expect((screen.getByLabelText('Additional prompt') as HTMLTextAreaElement).value).toBe('A'),
    );
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the notice of a save when the reread brings the new value', async () => {
    let written: string | null = null;
    const writeSetting = vi.fn(async (_path: string, value: unknown) => {
      written = value as string;
      return { ok: true as const, revision: 'p2', file: '/repo/aip/settings.yaml' };
    });
    const systemStages = vi.fn(async () =>
      systemStagesView({
        stages: systemStagesView().stages.map((stage) =>
          stage.kind === 'resolve' && written !== null
            ? {
                ...stage,
                settings: [
                  { path: 'delivery.resolver_prompt', value: written, level: 'project' as const },
                ],
              }
            : stage,
        ),
      }),
    );
    render(<Page api={api({ writeSetting, systemStages })} start="resolve" />);
    await screen.findByRole('textbox', { name: /built-in task/ });
    fireEvent.change(screen.getByLabelText('Additional prompt'), {
      target: { value: 'Keep the newer file' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(systemStages.mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText(/Saved to \/repo\/aip\/settings.yaml/)).toBeTruthy();
    expect((screen.getByLabelText('Additional prompt') as HTMLTextAreaElement).value).toBe(
      'Keep the newer file',
    );
    expect(screen.getByRole('radio', { name: 'Project' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(writeSetting).toHaveBeenCalledWith(
      'delivery.resolver_prompt',
      'Keep the newer file',
      null,
      'project',
    );
  });

  it('shows the split as configured in the pipeline', async () => {
    render(<Page api={api()} start="split" />);
    expect(await screen.findByRole('heading', { name: 'Task split' })).toBeTruthy();
    expect(screen.getByText(/has no settings of its own/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows the failure when the stages do not load, and keeps the screen', async () => {
    render(
      <Page
        api={api({
          systemStages: vi.fn(async () => {
            throw new Error('daemon is down');
          }),
        })}
        start="message"
      />,
    );
    expect(await screen.findByText(/did not load: daemon is down/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Commit message' })).toBeTruthy();
  });

  it('shows an empty screen for an unknown kind', async () => {
    render(<Page api={api()} start="nothing" />);
    expect(await screen.findByText('Pick a system stage.')).toBeTruthy();
  });
});
