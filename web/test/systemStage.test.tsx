// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/api.ts';
import PipelinesPage from '../src/components/PipelinesPage.tsx';
import type { ConfigEditorResponse, EditorSetting } from '../src/types.ts';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, settingsOf, systemStagesView } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function api(overrides: Partial<Api> = {}, view: () => ConfigEditorResponse = configView): Api {
  return fakeApi({
    config: vi.fn(async () => view()),
    systemStages: vi.fn(async () => systemStagesView()),
    ...overrides,
  });
}

/** A configuration whose settings are overridden by path. */
const withSettings = (overrides: Record<string, Partial<EditorSetting>>) => () =>
  configView({
    settings: settingsOf(
      Object.fromEntries(
        Object.entries(overrides).map(([path, value]) => [path, { path, ...value }]),
      ),
    ),
  });

function Page({ api, start, level = null }: { api: Api; start: string; level?: 'global' | null }) {
  const [selected, setSelected] = useState<string | null>(start);
  const [scope, setScope] = useState<string | null>(level);
  return (
    <PipelinesPage
      api={api}
      runs={[]}
      selected={selected}
      section="system"
      scope={scope}
      onSelect={(id, _section, next = null) => {
        setSelected(id);
        setScope(next);
      }}
    />
  );
}

const ok = () =>
  vi.fn(async () => ({ ok: true as const, revision: 'p2', file: '/repo/aip/settings.yaml' }));
const field = (path: string) => screen.findByTestId(`setting-${path}`);
const prompt = (path: string) =>
  within(screen.getByTestId(`setting-${path}`)).getByRole<HTMLTextAreaElement>('textbox');
const save = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
const tab = (name: string) => screen.getByRole('tab', { name });

const OLD = {
  'delivery.resolver_prompt': {
    value: 'Project note',
    globalValue: 'Shared note',
    written: { project: 'Project note', global: 'Shared note' },
  },
};

describe('the screen of a system stage', () => {
  it('shows the built-in task read only', async () => {
    render(<Page api={api()} start="resolve" />);
    const task = await screen.findByRole('textbox', { name: /built-in task/ });
    expect((task as HTMLTextAreaElement).readOnly).toBe(true);
    expect((task as HTMLTextAreaElement).value).toBe('Resolve the conflicts of {run}.');
    expect(screen.getByRole('heading', { name: 'Delivery conflict resolution' })).toBeTruthy();
  });

  it('opens on the project tab with the value and the source of the project', async () => {
    render(<Page api={api({}, withSettings(OLD))} start="resolve" />);
    await field('delivery.resolver_prompt');
    expect(tab('Project').getAttribute('aria-selected')).toBe('true');
    expect(prompt('delivery.resolver_prompt').value).toBe('Project note');
    expect(
      within(screen.getByTestId('setting-delivery.resolver_prompt')).getByText(
        'set in the project',
      ),
    ).toBeTruthy();
    expect(screen.getByText('/repo/aip/settings.yaml')).toBeTruthy();
  });

  it('shows the value of the shared level on the shared tab', async () => {
    render(<Page api={api({}, withSettings(OLD))} start="resolve" level="global" />);
    await field('delivery.resolver_prompt');
    expect(tab('Shared').getAttribute('aria-selected')).toBe('true');
    expect(prompt('delivery.resolver_prompt').value).toBe('Shared note');
    expect(screen.getByText('/xdg/aip/settings.yaml')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Inherit' })).toBeNull();
  });

  it('marks a value that is only set in the shared file on the shared tab', async () => {
    render(<Page api={api({}, withSettings(OLD))} start="resolve" level="global" />);
    await field('delivery.resolver_prompt');
    expect(
      within(screen.getByTestId('setting-delivery.resolver_prompt')).getByText('set in this file'),
    ).toBeTruthy();
  });

  it('marks the default on the shared tab when nothing is written', async () => {
    render(<Page api={api()} start="resolve" level="global" />);
    await field('delivery.resolver_rounds');
    expect((screen.getByLabelText('Resolver rounds') as HTMLInputElement).value).toBe('3');
    expect(
      within(screen.getByTestId('setting-delivery.resolver_rounds')).getByText('default'),
    ).toBeTruthy();
  });

  it('has the three fields on the commit message stage and writes the commit message', async () => {
    const writeSettings = ok();
    render(<Page api={api({ writeSettings })} start="message" />);
    await field('delivery.message_specialist');
    await field('delivery.commit_message');
    await field('delivery.message_prompt');
    fireEvent.change(prompt('delivery.commit_message'), {
      target: { value: '{title}\n\nChanges:\n{groups}' },
    });
    fireEvent.click(save());
    await waitFor(() => expect(writeSettings).toHaveBeenCalledTimes(1));
    expect(writeSettings).toHaveBeenCalledWith(
      { 'delivery.commit_message': '{title}\n\nChanges:\n{groups}' },
      null,
      'project',
    );
  });

  it('marks a value the project inherits', async () => {
    render(
      <Page
        api={api(
          {},
          withSettings({
            'delivery.resolver_prompt': {
              value: 'Shared note',
              globalValue: 'Shared note',
              written: { global: 'Shared note' },
            },
          }),
        )}
        start="resolve"
      />,
    );
    await field('delivery.resolver_prompt');
    expect(prompt('delivery.resolver_prompt').value).toBe('Shared note');
    expect(screen.getByText('inherited from the shared settings')).toBeTruthy();
  });

  it('writes the project value in one request with the revision of the project file', async () => {
    const writeSettings = ok();
    render(<Page api={api({ writeSettings })} start="resolve" />);
    await field('delivery.resolver_prompt');
    fireEvent.change(prompt('delivery.resolver_prompt'), {
      target: { value: 'Keep the newer file' },
    });
    fireEvent.click(save());
    await waitFor(() => expect(writeSettings).toHaveBeenCalledTimes(1));
    expect(writeSettings).toHaveBeenCalledWith(
      { 'delivery.resolver_prompt': 'Keep the newer file' },
      null,
      'project',
    );
  });

  it('writes the shared value with the revision of the shared file', async () => {
    const writeSettings = ok();
    render(<Page api={api({ writeSettings })} start="message" level="global" />);
    await field('delivery.message_prompt');
    fireEvent.change(prompt('delivery.message_prompt'), { target: { value: 'One line' } });
    fireEvent.click(save());
    await waitFor(() => expect(writeSettings).toHaveBeenCalled());
    expect(writeSettings).toHaveBeenCalledWith(
      { 'delivery.message_prompt': 'One line' },
      'g1',
      'global',
    );
  });

  it('writes several fields of the stage together', async () => {
    const writeSettings = ok();
    render(<Page api={api({ writeSettings })} start="resolve" />);
    await field('delivery.resolver_rounds');
    fireEvent.change(screen.getByLabelText('Resolver rounds'), { target: { value: '5' } });
    fireEvent.change(prompt('delivery.resolver_prompt'), { target: { value: 'Note' } });
    fireEvent.click(save());
    await waitFor(() => expect(writeSettings).toHaveBeenCalledTimes(1));
    expect(writeSettings).toHaveBeenCalledWith(
      { 'delivery.resolver_rounds': 5, 'delivery.resolver_prompt': 'Note' },
      null,
      'project',
    );
  });

  it('returns a field of the project to the shared value with «Inherit»', async () => {
    const writeSettings = ok();
    render(<Page api={api({ writeSettings }, withSettings(OLD))} start="resolve" />);
    await field('delivery.resolver_prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Inherit' }));
    expect(prompt('delivery.resolver_prompt').value).toBe('Shared note');
    fireEvent.click(save());
    await waitFor(() => expect(writeSettings).toHaveBeenCalled());
    expect(writeSettings).toHaveBeenCalledWith(
      { 'delivery.resolver_prompt': null },
      null,
      'project',
    );
  });

  it('removes the additional prompt when the field holds only spaces', async () => {
    const writeSettings = ok();
    render(<Page api={api({ writeSettings }, withSettings(OLD))} start="resolve" />);
    await field('delivery.resolver_prompt');
    fireEvent.change(prompt('delivery.resolver_prompt'), { target: { value: '  \n ' } });
    fireEvent.click(save());
    await waitFor(() => expect(writeSettings).toHaveBeenCalled());
    expect(writeSettings).toHaveBeenCalledWith(
      { 'delivery.resolver_prompt': null },
      null,
      'project',
    );
  });

  it('shows the error of a refused write at the field', async () => {
    const writeSettings = vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [{ path: 'delivery.resolver_prompt', message: 'must be a string' }],
    }));
    render(<Page api={api({ writeSettings })} start="resolve" />);
    await field('delivery.resolver_prompt');
    fireEvent.change(prompt('delivery.resolver_prompt'), { target: { value: 'x' } });
    fireEvent.click(save());
    expect(await screen.findByText('must be a string')).toBeTruthy();
  });

  it('reports a conflict of the file revision and rereads on «Reload»', async () => {
    const writeSettings = vi.fn(async () => ({
      ok: false as const,
      reason: 'conflict' as const,
      message: 'revision changed',
    }));
    const stageApi = api({ writeSettings });
    render(<Page api={stageApi} start="resolve" />);
    await field('delivery.resolver_prompt');
    fireEvent.change(prompt('delivery.resolver_prompt'), { target: { value: 'x' } });
    fireEvent.click(save());
    expect(await screen.findByText(/Not saved: revision changed/)).toBeTruthy();
    const before = vi.mocked(stageApi.config).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(vi.mocked(stageApi.config).mock.calls.length).toBeGreaterThan(before),
    );
    expect(prompt('delivery.resolver_prompt').value).toBe('');
  });

  it('rereads the stages after a write', async () => {
    const stageApi = api({ writeSettings: ok() });
    render(<Page api={stageApi} start="resolve" />);
    await field('delivery.resolver_prompt');
    fireEvent.change(prompt('delivery.resolver_prompt'), { target: { value: 'x' } });
    fireEvent.click(save());
    await waitFor(() =>
      expect(vi.mocked(stageApi.systemStages).mock.calls.length).toBeGreaterThan(1),
    );
  });

  it('shows the settings of the delivery stage without additional prompts', async () => {
    const writeSettings = ok();
    render(<Page api={api({ writeSettings })} start="delivery" />);
    expect(await screen.findByText('Built-in task')).toBeTruthy();
    expect(screen.getByText('This stage has no task: the system does the work.')).toBeTruthy();
    await field('delivery.mode');
    expect(screen.queryByText('delivery.message_prompt')).toBeNull();
    expect(screen.queryByText('delivery.resolver_prompt')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Keep the result' }));
    fireEvent.click(save());
    await waitFor(() => expect(writeSettings).toHaveBeenCalled());
    expect(writeSettings).toHaveBeenCalledWith({ 'delivery.keep': true }, null, 'project');
  });

  it('shows the split without level tabs', async () => {
    render(<Page api={api()} start="split" />);
    expect(await screen.findByRole('heading', { name: 'Task split' })).toBeTruthy();
    expect(screen.getByText(/has no settings of its own/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Shared' })).toBeNull();
  });

  it('keeps the shared tab when another stage is chosen', async () => {
    render(<Page api={api()} start="resolve" level="global" />);
    await field('delivery.resolver_prompt');
    const list = within(screen.getByRole('list', { name: 'System stages' }));
    fireEvent.click(list.getByRole('button', { name: /Commit message/ }));
    await field('delivery.message_prompt');
    expect(tab('Shared').getAttribute('aria-selected')).toBe('true');
  });

  it('switches the level tab and asks before dropping unsaved edits', async () => {
    render(<Page api={api()} start="resolve" />);
    await field('delivery.resolver_prompt');
    fireEvent.change(prompt('delivery.resolver_prompt'), { target: { value: 'draft' } });
    fireEvent.click(tab('Shared'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(tab('Project').getAttribute('aria-selected')).toBe('true');
    expect(prompt('delivery.resolver_prompt').value).toBe('draft');
    fireEvent.click(tab('Shared'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(tab('Shared').getAttribute('aria-selected')).toBe('true'));
    expect(prompt('delivery.resolver_prompt').value).toBe('');
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
