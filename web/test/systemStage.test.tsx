// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/shared/api/api.ts';
import PipelinesPage from '../src/features/pipelines/PipelinesPage.tsx';
import type { SystemStagesResponse } from '../src/shared/lib/pipeline/pipelineEntries.ts';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, specialistEntry, systemStagesView } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Setting = SystemStagesResponse['stages'][number]['settings'][number];

/** The stages with the settings of one of them replaced. */
const withStage = (kind: string, settings: Setting[]) => () =>
  systemStagesView({
    stages: systemStagesView().stages.map((stage) =>
      stage.kind === kind ? { ...stage, settings } : stage,
    ),
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

const value = (path: string) => screen.findByTestId(`stage-value-${path}`);
const editLink = () => screen.findByRole('link', { name: 'Edit in Settings' });

describe('the screen of a system stage', () => {
  it('shows the built-in task read only', async () => {
    render(<Page api={api()} start="resolve" />);
    const task = await screen.findByRole('textbox', { name: /built-in task/ });
    expect((task as HTMLTextAreaElement).readOnly).toBe(true);
    expect((task as HTMLTextAreaElement).value).toBe('Resolve the conflicts of {run}.');
    expect(screen.getByRole('heading', { name: 'Delivery conflict resolution' })).toBeTruthy();
  });

  it('has no level tabs, no fields and no Save button', async () => {
    render(<Page api={api()} start="resolve" />);
    await value('delivery.resolver_prompt');
    expect(screen.queryByRole('tab', { name: 'Shared' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByTestId('setting-delivery.resolver_prompt')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Additional prompt' })).toBeNull();
  });

  it('shows the value of the project with its source', async () => {
    const systemStages = vi.fn(async () =>
      withStage('resolve', [
        { path: 'delivery.resolver_prompt', value: 'Line 1\nLine 2', level: 'project' },
      ])(),
    );
    render(<Page api={api({ systemStages })} start="resolve" />);
    await waitFor(async () =>
      expect((await value('delivery.resolver_prompt')).textContent).toContain('Line 1\nLine 2'),
    );
    expect((await value('delivery.resolver_prompt')).textContent).toContain('set in the project');
  });

  it('marks a value of the shared settings and a default', async () => {
    const systemStages = vi.fn(async () =>
      withStage('resolve', [
        { path: 'delivery.resolver_prompt', value: 'Shared note', level: 'global' },
        { path: 'delivery.resolver_rounds', value: 1, level: 'default' },
      ])(),
    );
    render(<Page api={api({ systemStages })} start="resolve" />);
    await waitFor(async () =>
      expect((await value('delivery.resolver_prompt')).textContent).toContain('Shared note'),
    );
    const prompt = await value('delivery.resolver_prompt');
    expect(within(prompt).getByTestId('stage-source').textContent).toBe(
      'set in the shared settings',
    );
    const rounds = await value('delivery.resolver_rounds');
    expect(within(rounds).getByTestId('stage-shown').textContent).toBe('1');
    expect(within(rounds).getByTestId('stage-source').textContent).toBe('default');
  });

  it('shows the fields of the commit message stage and «not set» for an empty one', async () => {
    render(<Page api={api()} start="message" />);
    await value('delivery.message_specialist');
    await value('delivery.commit_message');
    expect((await value('delivery.message_prompt')).textContent).toContain('not set');
  });

  it('shows the specialists of the stages by «Name (slug)»', async () => {
    const config = vi.fn(async () =>
      configView({ specialists: [specialistEntry('coder', {}, { name: 'Кодер' })] }),
    );
    const systemStages = vi.fn(async () =>
      withStage('resolve', [{ path: 'delivery.resolver', value: 'coder', level: 'project' }])(),
    );
    render(<Page api={api({ config, systemStages })} start="resolve" />);
    await waitFor(async () =>
      expect(within(await value('delivery.resolver')).getByTestId('stage-shown').textContent).toBe(
        'Кодер (coder)',
      ),
    );
  });

  it('shows the delivery mode by its name and a flag as yes or no', async () => {
    const systemStages = vi.fn(async () =>
      withStage('delivery', [
        { path: 'delivery.mode', value: 'branch', level: 'project' },
        { path: 'delivery.keep', value: true, level: 'global' },
        { path: 'delivery.auto', value: false, level: 'default' },
      ])(),
    );
    render(<Page api={api({ systemStages })} start="delivery" />);
    expect(await screen.findByText('Built-in task')).toBeTruthy();
    expect(screen.getByText('This stage has no task: the system does the work.')).toBeTruthy();
    await waitFor(async () =>
      expect((await value('delivery.mode')).textContent).toContain('Branch'),
    );
    expect(within(await value('delivery.keep')).getByTestId('stage-shown').textContent).toBe('yes');
    expect(within(await value('delivery.auto')).getByTestId('stage-shown').textContent).toBe('no');
    expect(screen.queryByText('delivery.message_prompt')).toBeNull();
    expect(screen.queryByText('delivery.resolver_prompt')).toBeNull();
  });

  it('leads the button to the project settings when the project sets a field', async () => {
    const systemStages = vi.fn(async () =>
      withStage('resolve', [{ path: 'delivery.resolver', value: 'coder', level: 'project' }])(),
    );
    render(<Page api={api({ systemStages })} start="resolve" />);
    await waitFor(async () =>
      expect((await editLink()).getAttribute('href')).toBe('#settings/project/delivery'),
    );
  });

  it('leads the button to the shared settings otherwise', async () => {
    render(<Page api={api()} start="resolve" />);
    expect((await editLink()).getAttribute('href')).toBe('#settings/global/delivery');
  });

  it('leads the button to the shared settings while the stages do not load', async () => {
    const systemStages = vi.fn(async () => {
      throw new Error('daemon is down');
    });
    render(<Page api={api({ systemStages })} start="message" />);
    expect(await screen.findByText(/did not load: daemon is down/)).toBeTruthy();
    expect((await editLink()).getAttribute('href')).toBe('#settings/global/delivery');
    expect(screen.getByRole('heading', { name: 'Commit message' })).toBeTruthy();
  });

  it('shows the split without settings and without the button', async () => {
    render(<Page api={api()} start="split" />);
    expect(await screen.findByRole('heading', { name: 'Task split' })).toBeTruthy();
    expect(screen.getByText(/has no settings of its own/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit in Settings' })).toBeNull();
  });

  it('moves to another stage without asking', async () => {
    render(<Page api={api()} start="resolve" />);
    await value('delivery.resolver_prompt');
    const list = within(screen.getByRole('list', { name: 'System stages' }));
    fireEvent.click(list.getByRole('button', { name: /Commit message/ }));
    await value('delivery.message_prompt');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows an empty screen for an unknown kind', async () => {
    render(<Page api={api()} start="nothing" />);
    expect(await screen.findByText('Pick a system stage.')).toBeTruthy();
  });
});
