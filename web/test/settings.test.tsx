// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { ApiError } from '../src/api.ts';

import {
  FakeEventSource,
  configView,
  fakeApi,
  openFake,
  queueOf,
  settingsOf,
  systemView,
} from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '#settings/queue';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function show(queue = queueOf(), overrides = {}, hash = '#settings/queue') {
  window.location.hash = hash;
  const api = fakeApi({ queue: vi.fn(async () => queue), ...overrides });
  render(<App api={api} openStream={openFake} />);
  return api;
}

function stream(): FakeEventSource {
  const source = FakeEventSource.last;
  if (!source) throw new Error('no event source');
  return source;
}

describe('queue settings block', () => {
  const settingsBlock = async () =>
    within(await screen.findByRole('region', { name: 'queue settings' }));

  it('shows the three switches with hints, the repository and no start or pause', async () => {
    show(queueOf());
    const block = await settingsBlock();
    for (const name of ['Autopilot', 'Skip failed', 'Auto delivery by default']) {
      expect(block.getByRole('switch', { name })).toBeTruthy();
    }
    expect(block.getByText(/does not stop when it becomes empty/)).toBeTruthy();
    expect(block.getByText(/leaves its place/)).toBeTruthy();
    expect(block.getByText(/tasks without their own auto delivery/)).toBeTruthy();
    expect(block.getByText(/the queue of repo/)).toBeTruthy();
    expect(block.getByRole('link', { name: 'Open the queue' }).getAttribute('href')).toBe('#queue');
    expect(block.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(block.queryByLabelText('Parallelism')).toBeNull();
  });

  it('sends only skipFailed when the switch is turned on', async () => {
    const api = show(queueOf({ parallel: 2 }), {
      queueSettings: vi.fn(async () => queueOf({ parallel: 2, skipFailed: true })),
    });
    const block = await settingsBlock();
    const toggle = block.getByRole('switch', { name: 'Skip failed' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(api.queueSettings).toHaveBeenCalledWith({ skipFailed: true }));
    await waitFor(() =>
      expect(block.getByRole('switch', { name: 'Skip failed' }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    expect(block.getByRole('switch', { name: 'Autopilot' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(api.queueSettings).toHaveBeenCalledTimes(1);
  });

  it('returns the switch and shows the error when the server refuses', async () => {
    show(queueOf(), {
      queueSettings: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const block = await settingsBlock();
    fireEvent.click(block.getByRole('switch', { name: 'Autopilot' }));
    await screen.findAllByText('boom');
    expect(block.getByRole('switch', { name: 'Autopilot' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('follows the queue event', async () => {
    show(queueOf());
    const block = await settingsBlock();
    act(() => {
      stream().open();
      stream().send({
        event: 'queue',
        seq: 5,
        queue: queueOf({ autopilot: true, skipFailed: true }),
      });
    });
    await waitFor(() =>
      expect(block.getByRole('switch', { name: 'Autopilot' }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    expect(block.getByRole('switch', { name: 'Skip failed' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('writes delivery.auto to the global settings when auto delivery is turned off', async () => {
    const api = show(queueOf({ autoDeliver: true }));
    const block = await settingsBlock();
    const toggle = await waitFor(() => {
      const found = block.getByRole<HTMLButtonElement>('switch', {
        name: 'Auto delivery by default',
      });
      expect(found.disabled).toBe(false);
      return found;
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.auto', false, 'g1', 'global'),
    );
    act(() => {
      stream().open();
      stream().send({ event: 'queue', seq: 5, queue: queueOf({ autoDeliver: false }) });
    });
    await waitFor(() =>
      expect(
        block
          .getByRole('switch', { name: 'Auto delivery by default' })
          .getAttribute('aria-checked'),
      ).toBe('false'),
    );
  });

  const projectSetting = (path: string, value: boolean | string) =>
    configView({
      settingsFiles: {
        global: { file: '/xdg/aip/settings.yaml', revision: 'g1' },
        project: { file: '/repo/aip/settings.yaml', revision: 'p1' },
      },
      settings: settingsOf({ [path]: { path, value, file: '/repo/aip/settings.yaml' } }),
    });

  it('writes the value set in the project file back to the project file', async () => {
    const api = show(queueOf({ autoDeliver: true }), {
      config: vi.fn(async () => projectSetting('delivery.auto', true)),
    });
    const block = await settingsBlock();
    const toggle = await waitFor(() => {
      const found = block.getByRole<HTMLButtonElement>('switch', {
        name: 'Auto delivery by default',
      });
      expect(found.disabled).toBe(false);
      return found;
    });
    expect(block.getByText('Saved to the project file: /repo/aip/settings.yaml')).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.auto', false, 'p1', 'project'),
    );
  });

  it('shows the shared file for a value that is not in the project file', async () => {
    show(queueOf({ autoDeliver: true }));
    const block = await settingsBlock();
    await waitFor(() =>
      expect(block.getAllByText('Saved to the shared file: /xdg/aip/settings.yaml').length).toBe(2),
    );
  });

  it('disables auto delivery while the configuration is invalid', async () => {
    show(queueOf({ autoDeliver: null }));
    const block = await settingsBlock();
    expect(
      block.getByRole<HTMLButtonElement>('switch', { name: 'Auto delivery by default' }).disabled,
    ).toBe(true);
    expect(block.getAllByText('The configuration is not valid').length).toBeGreaterThan(0);
  });
});

describe('delivery mode in the queue settings', () => {
  const settingsBlock = async () =>
    within(await screen.findByRole('region', { name: 'queue settings' }));

  it('shows the mode and writes delivery.mode to the global settings', async () => {
    const api = show(queueOf({ deliveryMode: 'worktree' }));
    const block = await settingsBlock();
    const select = await waitFor(() => {
      const found = block.getByRole<HTMLButtonElement>('combobox', { name: 'Delivery mode' });
      expect(found.disabled).toBe(false);
      return found;
    });
    expect(select.textContent).toBe('In the working tree');
    fireEvent.keyDown(select, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Commit' }));
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.mode', 'commit', 'g1', 'global'),
    );
    act(() => {
      stream().open();
      stream().send({ event: 'queue', seq: 5, queue: queueOf({ deliveryMode: 'commit' }) });
    });
    await waitFor(() =>
      expect(block.getByRole('combobox', { name: 'Delivery mode' }).textContent).toBe('Commit'),
    );
  });

  const settingsFiles = {
    global: { file: '/xdg/aip/settings.yaml', revision: 'g1' },
    project: { file: '/repo/aip/settings.yaml', revision: 'p1' },
  };
  const pick = async (name: string) => {
    const block = await settingsBlock();
    const select = await waitFor(() => {
      const found = block.getByRole<HTMLButtonElement>('combobox', { name: 'Delivery mode' });
      expect(found.disabled).toBe(false);
      return found;
    });
    fireEvent.keyDown(select, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name }));
  };

  it('writes the mode set in the project file back to the project file', async () => {
    const api = show(queueOf({ deliveryMode: 'worktree' }), {
      config: vi.fn(async () =>
        configView({
          settingsFiles,
          settings: settingsOf({
            'delivery.mode': {
              path: 'delivery.mode',
              value: 'worktree',
              file: '/repo/aip/settings.yaml',
            },
          }),
        }),
      ),
    });
    const block = await settingsBlock();
    await pick('Commit');
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.mode', 'commit', 'p1', 'project'),
    );
    expect(block.getByText('Saved to the project file: /repo/aip/settings.yaml')).toBeTruthy();
  });

  it('is unavailable while the configuration is invalid', async () => {
    show(queueOf({ deliveryMode: null }));
    const invalid = await settingsBlock();
    expect(
      invalid.getByRole<HTMLButtonElement>('combobox', { name: 'Delivery mode' }).disabled,
    ).toBe(true);
    expect(invalid.getAllByText('The configuration is not valid').length).toBeGreaterThan(0);
  });

  it('shows an error when the configuration cannot be read', async () => {
    show(queueOf({}), {
      config: vi.fn(async () => {
        throw new Error('config unreadable');
      }),
    });
    const block = await settingsBlock();
    expect((await block.findAllByText('config unreadable')).length).toBeGreaterThan(0);
  });

  it('toggling auto delivery then choosing a mode writes both without conflict', async () => {
    let revision = 'g1';
    const api = show(queueOf({ autoDeliver: true, deliveryMode: 'worktree' }), {
      config: vi.fn(async () =>
        configView({
          settingsFiles: { ...settingsFiles, global: { ...settingsFiles.global, revision } },
        }),
      ),
      writeSetting: vi.fn(async () => {
        revision = 'g2';
        return { ok: true as const, revision: 'g2' };
      }),
    });
    const block = await settingsBlock();
    const toggle = await waitFor(() => {
      const found = block.getByRole<HTMLButtonElement>('switch', {
        name: 'Auto delivery by default',
      });
      expect(found.disabled).toBe(false);
      return found;
    });
    const reads = vi.mocked(api.config).mock.calls.length;
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.auto', false, 'g1', 'global'),
    );
    await waitFor(() => expect(vi.mocked(api.config).mock.calls.length).toBeGreaterThan(reads));
    await pick('Branch');
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.mode', 'branch', 'g2', 'global'),
    );
  });

  it('shows a write conflict and writes the next time with the re-read revision', async () => {
    let revision = 'g1';
    const writeSetting = vi
      .fn()
      .mockImplementationOnce(async () => {
        revision = 'g3';
        return { ok: false as const, reason: 'conflict' as const, message: 'changed' };
      })
      .mockImplementation(async () => ({ ok: true as const, revision: 'g4' }));
    const api = show(queueOf({ deliveryMode: 'worktree' }), {
      config: vi.fn(async () =>
        configView({
          settingsFiles: { ...settingsFiles, global: { ...settingsFiles.global, revision } },
        }),
      ),
      writeSetting,
    });
    const block = await settingsBlock();
    const reads = vi.mocked(api.config).mock.calls.length;
    await pick('Commit');
    await waitFor(() => expect(block.getByText('Not saved: changed')).toBeTruthy());
    await waitFor(() => expect(vi.mocked(api.config).mock.calls.length).toBeGreaterThan(reads));
    await pick('Branch');
    await waitFor(() =>
      expect(writeSetting).toHaveBeenLastCalledWith('delivery.mode', 'branch', 'g3', 'global'),
    );
  });
});

describe('answer of the autopilot in the queue settings', () => {
  const settingsBlock = async () =>
    within(await screen.findByRole('region', { name: 'queue settings' }));

  it('shows the default text, saves a text and resets it', async () => {
    const api = show(queueOf({ autopilotAnswerDefault: 'Agree with all' }), {
      queueSettings: vi.fn(async () => queueOf({ autopilotAnswer: 'Pick the simplest' })),
    });
    const block = await settingsBlock();
    const field = block.getByRole<HTMLTextAreaElement>('textbox', { name: 'Answer to questions' });
    expect(field.value).toBe('Agree with all');
    const save = block.getByRole<HTMLButtonElement>('button', { name: 'Save answer' });
    const reset = block.getByRole<HTMLButtonElement>('button', { name: 'Default answer' });
    expect(save.disabled).toBe(true);
    expect(reset.disabled).toBe(true);
    fireEvent.change(field, { target: { value: '  Pick the simplest ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.queueSettings).toHaveBeenCalledWith({ autopilotAnswer: 'Pick the simplest' }),
    );
    await waitFor(() => expect(field.value).toBe('Pick the simplest'));
    await waitFor(() => expect(reset.disabled).toBe(false));
    fireEvent.click(reset);
    await waitFor(() =>
      expect(api.queueSettings).toHaveBeenLastCalledWith({ autopilotAnswer: null }),
    );
  });

  it('keeps unsaved text over a queue event', async () => {
    show(queueOf({ autopilotAnswerDefault: 'Agree with all' }));
    const block = await settingsBlock();
    const field = block.getByRole<HTMLTextAreaElement>('textbox', { name: 'Answer to questions' });
    fireEvent.change(field, { target: { value: 'Мой текст' } });
    act(() => {
      stream().open();
      stream().send({
        event: 'queue',
        seq: 5,
        queue: queueOf({ autopilotAnswer: 'Другой', autopilotAnswerDefault: 'Agree with all' }),
      });
    });
    expect(field.value).toBe('Мой текст');
  });
});

const GLOBAL_FILE = '/xdg/aip/settings.yaml';
const PROJECT_FILE = '/repo/aip/settings.yaml';
const FILES = {
  global: { file: GLOBAL_FILE, revision: 'g1' },
  project: { file: PROJECT_FILE, revision: 'p1' },
};

const GLOBAL_GROUPS = ['General', 'Agents', 'Delivery', 'Runtimes', 'System', 'Tags'];
const PROJECT_GROUPS = ['General', 'Agents', 'Delivery', 'Queue'];

const groupNav = () => screen.getByRole('navigation', { name: 'groups of settings' });
const groupNames = () =>
  within(groupNav())
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('settings page', () => {
  it('has the tabs Shared and Project and opens General of Shared by default', async () => {
    show(queueOf(), {}, '#settings');
    await screen.findByTestId('setting-max');
    const tabs = within(screen.getByRole('tablist', { name: 'level of settings' }));
    expect(tabs.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Shared', 'Project']);
    expect(tabs.getByRole('tab', { name: 'Shared' }).getAttribute('aria-selected')).toBe('true');
    expect(groupNames()).toEqual(GLOBAL_GROUPS);
    expect(
      within(groupNav()).getByRole('link', { name: 'General' }).getAttribute('aria-current'),
    ).toBe('page');
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/general'));
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByText(GLOBAL_FILE)).toBeTruthy();
  });

  it('has other groups on the Project tab and a selector of the project only there', async () => {
    show(queueOf(), {}, '#settings/project/general');
    await screen.findByTestId('setting-max');
    expect(groupNames()).toEqual(PROJECT_GROUPS);
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeTruthy();
    expect(screen.getByText(PROJECT_FILE)).toBeTruthy();
    cleanup();
    show(queueOf(), {}, '#settings/global/general');
    await screen.findByTestId('setting-max');
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
  });

  it('shows forms and no table on every group', async () => {
    for (const hash of [
      '#settings/global/general',
      '#settings/global/agents',
      '#settings/global/delivery',
      '#settings/global/runtimes',
      '#settings/global/system',
      '#settings/project/delivery',
    ]) {
      show(queueOf(), {}, hash);
      await screen.findByRole('button', { name: 'Save' });
      expect(document.querySelector('table')).toBeNull();
      cleanup();
    }
  });

  it('opens a group by its address and shows only its fields', async () => {
    show(queueOf(), {}, '#settings/global/system');
    const port = await screen.findByTestId('setting-web.port');
    expect(within(port).getByLabelText<HTMLInputElement>('Port').value).toBe('7341');
    expect(port.textContent).toContain('default');
    expect(screen.queryByTestId('setting-max')).toBeNull();
  });

  it('opens General for a group the tab does not have', async () => {
    show(queueOf(), {}, '#settings/project/nope');
    await screen.findByTestId('setting-max');
    await waitFor(() => expect(window.location.hash).toBe('#settings/project/general'));
    cleanup();
    show(queueOf(), {}, '#settings/global/queue');
    await screen.findByTestId('setting-max');
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/general'));
  });

  it('leads the addresses of earlier versions to the new groups', async () => {
    for (const [old, now] of [
      ['#settings/delivery', '#settings/global/delivery'],
      ['#settings/web', '#settings/global/system'],
      ['#settings/naming', '#settings/global/general'],
      ['#settings/claude', '#settings/global/agents'],
      ['#settings/queue', '#settings/project/queue'],
      ['#specialists/_settings', '#settings/global/general'],
    ] as const) {
      show(queueOf(), {}, old);
      await screen.findByRole('navigation', { name: 'groups of settings' });
      await waitFor(() => expect(window.location.hash).toBe(now));
      cleanup();
    }
  });

  it('shows the default on the Shared tab and where it comes from', async () => {
    show(queueOf(), {}, '#settings/global/general');
    const max = await screen.findByTestId('setting-max');
    expect(within(max).getByLabelText<HTMLInputElement>('Parallel groups').value).toBe('3');
    expect(max.textContent).toContain('default');
  });

  it('shows the shared level on Shared and the result on Project', async () => {
    const config = vi.fn(async () =>
      configView({
        settings: settingsOf({
          max: {
            path: 'max',
            value: 5,
            globalValue: 3,
            file: PROJECT_FILE,
            written: { project: 5 },
          },
        }),
      }),
    );
    show(queueOf(), { config }, '#settings/global/general');
    const max = await screen.findByTestId('setting-max');
    expect(within(max).getByLabelText<HTMLInputElement>('Parallel groups').value).toBe('3');
    cleanup();
    show(queueOf(), { config }, '#settings/project/general');
    const own = await screen.findByTestId('setting-max');
    expect(within(own).getByLabelText<HTMLInputElement>('Parallel groups').value).toBe('5');
    expect(own.textContent).toContain('set in the project');
    expect(within(own).getByRole('button', { name: 'Inherit' })).toBeTruthy();
  });

  it('marks a value inherited from the shared settings in the project', async () => {
    show(
      queueOf(),
      {
        config: vi.fn(async () =>
          configView({
            settings: settingsOf({
              max: { path: 'max', value: 7, file: GLOBAL_FILE, written: { global: 7 } },
            }),
          }),
        ),
      },
      '#settings/project/general',
    );
    const max = await screen.findByTestId('setting-max');
    expect(max.textContent).toContain('inherited from the shared settings');
    expect(within(max).queryByRole('button', { name: 'Inherit' })).toBeNull();
  });

  it('has no fields of the web panel and runtimes in the project', async () => {
    show(queueOf(), {}, '#settings/project/delivery');
    await screen.findByTestId('setting-delivery.mode');
    expect(screen.queryByTestId('setting-web.port')).toBeNull();
    expect(screen.queryByTestId('setting-runtimes.claude.command')).toBeNull();
  });

  it('explains Runtimes and System and links to System', async () => {
    show(queueOf(), {}, '#settings/global/runtimes');
    const link = await screen.findByRole('link', { name: 'System' });
    expect(link.getAttribute('href')).toBe('#settings/global/system');
    expect(screen.getByText(/Changes take effect after the restart/)).toBeTruthy();
  });

  it('marks the group of a configuration error and shows the error in it', async () => {
    const config = vi.fn(async () =>
      configView({
        errors: [
          { file: PROJECT_FILE, path: 'swarm.delivery.keep', message: 'must be true or false' },
        ],
      }),
    );
    show(queueOf(), { config }, '#settings/global/general');
    const delivery = () => within(groupNav()).getByRole('link', { name: /^Delivery/ });
    await waitFor(() =>
      expect(within(delivery()).getByText('the group has configuration errors')).toBeTruthy(),
    );
    expect(within(groupNav()).getByRole('link', { name: 'General' }).textContent).toBe('General');
    fireEvent.click(delivery());
    const errors = await screen.findByRole('region', { name: 'configuration errors' });
    expect(within(errors).getByText('swarm.delivery.keep')).toBeTruthy();
    expect(
      within(screen.getByTestId('setting-delivery.keep')).getByText('must be true or false'),
    ).toBeTruthy();
  });

  it('shows the error of a specialist in General', async () => {
    show(
      queueOf(),
      {
        config: vi.fn(async () =>
          configView({
            errors: [{ file: PROJECT_FILE, path: 'swarm.specialists.coder.model', message: 'bad' }],
          }),
        ),
      },
      '#settings/global/general',
    );
    const errors = await screen.findByRole('region', { name: 'configuration errors' });
    expect(within(errors).getByText('swarm.specialists.coder.model')).toBeTruthy();
  });

  it('shows the catalog of tags in the Tags group', async () => {
    show(queueOf(), {}, '#settings/global/tags');
    expect(await screen.findByText('The tag catalog, shared by all repositories.')).toBeTruthy();
  });

  it('has no General settings entry in the list of specialists', async () => {
    show(queueOf(), {}, '#specialists');
    await screen.findByRole('list', { name: 'specialists' });
    expect(screen.queryByText('General settings')).toBeNull();
  });
});

describe('settings form', () => {
  const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
  const toggleOf = (name: string) => screen.getByRole('switch', { name });

  it('writes several fields of a group in one request', async () => {
    const api = show(queueOf(), {}, '#settings/global/delivery');
    await screen.findByTestId('setting-delivery.mode');
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(toggleOf('Auto delivery'));
    fireEvent.click(toggleOf('Keep the result'));
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'wip' } });
    fireEvent.change(screen.getByLabelText('Resolver rounds'), { target: { value: '5' } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.writeSettings).toHaveBeenCalledTimes(1));
    expect(api.writeSettings).toHaveBeenCalledWith(
      {
        'delivery.auto': false,
        'delivery.keep': true,
        'delivery.commit_message': 'wip',
        'delivery.resolver_rounds': 5,
      },
      'g1',
      'global',
    );
    await waitFor(() => expect(vi.mocked(api.config).mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it('writes a choice and a specialist reference', async () => {
    const api = show(queueOf(), {}, '#settings/global/delivery');
    const mode = await screen.findByRole('combobox', { name: 'Delivery mode' });
    fireEvent.keyDown(mode, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Branch' }));
    const resolver = screen.getByRole('combobox', { name: 'Conflict resolver' });
    fireEvent.keyDown(resolver, { key: 'Enter' });
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'not set',
      'coder',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'coder' }));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith(
        { 'delivery.mode': 'branch', 'delivery.resolver': 'coder' },
        'g1',
        'global',
      ),
    );
  });

  it('discards the changes', async () => {
    const api = show(queueOf(), {}, '#settings/global/delivery');
    await screen.findByTestId('setting-delivery.mode');
    fireEvent.click(toggleOf('Keep the result'));
    expect(toggleOf('Keep the result').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(toggleOf('Keep the result').getAttribute('aria-checked')).toBe('false');
    expect(saveButton().disabled).toBe(true);
    expect(api.writeSettings).not.toHaveBeenCalled();
  });

  it('is no change when a field returns to its saved value', async () => {
    show(queueOf(), {}, '#settings/global/delivery');
    await screen.findByTestId('setting-delivery.mode');
    fireEvent.click(toggleOf('Keep the result'));
    fireEvent.click(toggleOf('Keep the result'));
    expect(saveButton().disabled).toBe(true);
  });

  it('writes a list of strings and removes the key of an empty one', async () => {
    const config = vi.fn(async () =>
      configView({
        settings: settingsOf({
          'defaults.tools': {
            path: 'defaults.tools',
            value: ['Read', 'Edit'],
            written: { global: ['Read', 'Edit'] },
          },
        }),
      }),
    );
    const api = show(queueOf(), { config }, '#settings/global/agents');
    await screen.findByTestId('setting-defaults.tools');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Read' }));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenLastCalledWith(
        { 'defaults.tools': ['Edit'] },
        'g1',
        'global',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Read' }));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenLastCalledWith(
        { 'defaults.tools': null },
        'g1',
        'global',
      ),
    );
  });

  it('does not treat clearing an inherited field of the project as a change', async () => {
    const config = vi.fn(async () =>
      configView({
        settings: settingsOf({
          'naming.model': {
            path: 'naming.model',
            value: 'haiku',
            written: { global: 'haiku' },
          },
        }),
      }),
    );
    const api = show(queueOf(), { config }, '#settings/project/general');
    const model = await screen.findByLabelText('Naming model');
    fireEvent.change(model, { target: { value: '' } });
    expect(saveButton().disabled).toBe(true);
    expect(api.writeSettings).not.toHaveBeenCalled();
  });

  it('removes the key of a cleared field', async () => {
    const api = show(queueOf(), {}, '#settings/global/general');
    const model = await screen.findByLabelText('Naming model');
    fireEvent.change(model, { target: { value: '' } });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith({ 'naming.model': null }, 'g1', 'global'),
    );
  });

  it('returns a field of the project to the shared value with Inherit', async () => {
    const config = vi.fn(async () =>
      configView({
        settingsFiles: FILES,
        settings: settingsOf({
          'delivery.keep': {
            path: 'delivery.keep',
            value: true,
            globalValue: false,
            file: PROJECT_FILE,
            written: { project: true },
          },
        }),
      }),
    );
    const api = show(queueOf(), { config }, '#settings/project/delivery');
    await screen.findByTestId('setting-delivery.keep');
    expect(toggleOf('Keep the result').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(
      within(screen.getByTestId('setting-delivery.keep')).getByRole('button', { name: 'Inherit' }),
    );
    expect((toggleOf('Keep the result') as HTMLButtonElement).disabled).toBe(true);
    expect(toggleOf('Keep the result').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith({ 'delivery.keep': null }, 'p1', 'project'),
    );
  });

  it('writes to the project file on the Project tab', async () => {
    const api = show(
      queueOf(),
      { config: vi.fn(async () => configView({ settingsFiles: FILES })) },
      '#settings/project/general',
    );
    fireEvent.change(await screen.findByLabelText('Parallel groups'), { target: { value: '4' } });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith({ max: 4 }, 'p1', 'project'),
    );
  });

  it('shows a conflict and reads the file again with Reload', async () => {
    const api = show(
      queueOf(),
      {
        writeSettings: vi.fn(async () => ({
          ok: false as const,
          reason: 'conflict' as const,
          message: 'settings.yaml was changed after it was read',
        })),
      },
      '#settings/global/delivery',
    );
    await screen.findByTestId('setting-delivery.mode');
    fireEvent.click(toggleOf('Keep the result'));
    fireEvent.click(saveButton());
    const alert = await screen.findByText(/was changed after it was read/);
    expect(toggleOf('Keep the result').getAttribute('aria-checked')).toBe('true');
    const reads = vi.mocked(api.config).mock.calls.length;
    fireEvent.click(
      within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', {
        name: 'Reload',
      }),
    );
    await waitFor(() => expect(vi.mocked(api.config).mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() =>
      expect(toggleOf('Keep the result').getAttribute('aria-checked')).toBe('false'),
    );
  });

  it('shows the errors of validation at the fields', async () => {
    show(
      queueOf(),
      {
        writeSettings: vi.fn(async () => ({
          ok: false as const,
          reason: 'invalid' as const,
          errors: [
            { file: GLOBAL_FILE, path: 'swarm.max', message: 'must be an integer from 1 to 32' },
            { file: GLOBAL_FILE, path: 'swarm.specialists.x', message: 'elsewhere' },
          ],
        })),
      },
      '#settings/global/general',
    );
    fireEvent.change(await screen.findByLabelText('Parallel groups'), { target: { value: '99' } });
    fireEvent.click(saveButton());
    const max = await screen.findByTestId('setting-max');
    expect(await within(max).findByText('must be an integer from 1 to 32')).toBeTruthy();
    expect(screen.getByText(/elsewhere/)).toBeTruthy();
    expect(within(max).getByLabelText('Parallel groups').getAttribute('aria-invalid')).toBe('true');
  });

  it('puts the sections in cards, two in a row on a wide window', async () => {
    show(queueOf(), {}, '#settings/global/general');
    await screen.findByTestId('setting-max');
    const grid = screen.getByTestId('settings-sections');
    expect(grid.className).toContain('@3xl:grid-cols-2');
    expect(grid.parentElement?.className).toContain('@container');
    expect(
      within(grid)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Runs', 'Working copy', 'Naming']);
  });

  it('groups the runtimes by the agent and shows only the names of the variables', async () => {
    show(queueOf(), {}, '#settings/global/runtimes');
    const env = await screen.findByTestId('setting-runtimes.claude.env');
    expect(env.textContent).toContain('ANTHROPIC_API_KEY');
    expect(env.textContent).toContain('value is hidden');
    expect(screen.getByTestId('setting-runtimes.claude.command')).toBeTruthy();
    expect(
      within(
        screen.getByTestId('setting-runtimes.claude.command'),
      ).getByLabelText<HTMLInputElement>('Command').value,
    ).toBe('claude');
    expect(
      within(screen.getByRole('region', { name: 'OpenCode' })).getByLabelText<HTMLInputElement>(
        'Command',
      ).value,
    ).toBe('opencode');
  });

  it('adds, replaces and deletes variables with values only on write', async () => {
    const api = show(queueOf(), {}, '#settings/global/runtimes');
    await screen.findByTestId('setting-runtimes.claude.env');
    const claude = within(screen.getByRole('region', { name: 'Claude' }));
    fireEvent.change(claude.getByLabelText('Variable name of claude'), {
      target: { value: 'NEW_KEY' },
    });
    fireEvent.change(claude.getByLabelText('Variable value of claude'), {
      target: { value: 's3cret' },
    });
    fireEvent.click(claude.getByRole('button', { name: 'Add to claude' }));
    expect(claude.getByText('will be added')).toBeTruthy();
    fireEvent.click(claude.getByRole('button', { name: /^Replace value ANTHROPIC_API_KEY/ }));
    fireEvent.change(claude.getByLabelText('New value of ANTHROPIC_API_KEY'), {
      target: { value: 'fresh' },
    });
    expect(document.body.innerHTML).not.toContain('s3cret');
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith(
        {
          'runtimes.claude.env.NEW_KEY': 's3cret',
          'runtimes.claude.env.ANTHROPIC_API_KEY': 'fresh',
        },
        'g1',
        'global',
      ),
    );
  });

  it('deletes a variable and can undo it', async () => {
    const api = show(queueOf(), {}, '#settings/global/runtimes');
    await screen.findByTestId('setting-runtimes.claude.env');
    const claude = within(screen.getByRole('region', { name: 'Claude' }));
    fireEvent.click(claude.getByRole('button', { name: /^Delete ANTHROPIC_API_KEY/ }));
    expect(claude.getByText('will be deleted')).toBeTruthy();
    fireEvent.click(claude.getByRole('button', { name: /^Undo ANTHROPIC_API_KEY/ }));
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(claude.getByRole('button', { name: /^Delete ANTHROPIC_API_KEY/ }));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith(
        { 'runtimes.claude.env.ANTHROPIC_API_KEY': null },
        'g1',
        'global',
      ),
    );
  });

  it('refuses a name that is not a variable name', async () => {
    show(queueOf(), {}, '#settings/global/runtimes');
    await screen.findByTestId('setting-runtimes.claude.env');
    const claude = within(screen.getByRole('region', { name: 'Claude' }));
    fireEvent.change(claude.getByLabelText('Variable name of claude'), {
      target: { value: '1BAD' },
    });
    expect(claude.getByText('Not a valid variable name.')).toBeTruthy();
    expect(claude.getByRole<HTMLButtonElement>('button', { name: 'Add to claude' }).disabled).toBe(
      true,
    );
  });

  it('asks before leaving a group with unsaved changes', async () => {
    show(queueOf(), {}, '#settings/global/delivery');
    await screen.findByTestId('setting-delivery.mode');
    fireEvent.click(toggleOf('Keep the result'));
    fireEvent.click(within(groupNav()).getByRole('link', { name: 'General' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Leave without saving?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(window.location.hash).toBe('#settings/global/delivery');
    fireEvent.click(within(groupNav()).getByRole('link', { name: 'General' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/general'));
  });

  it('asks before leaving for the other tab and not when nothing changed', async () => {
    show(queueOf(), {}, '#settings/global/delivery');
    await screen.findByTestId('setting-delivery.mode');
    fireEvent.click(screen.getByRole('tab', { name: 'Project' }));
    await waitFor(() => expect(window.location.hash).toBe('#settings/project/delivery'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(toggleOf('Keep the result'));
    fireEvent.click(screen.getByRole('tab', { name: 'Shared' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });
});

describe('project of the settings', () => {
  const APP = '/work/app';
  const LIB = '/work/lib';
  const entry = (path: string) => ({ path, addedAt: 1, unfinished: 0, waiting: 0, queued: 0 });

  function open(hash: string, repositories = [entry(APP), entry(LIB)]) {
    const api = show(queueOf({ repository: APP }), {}, hash);
    act(() => {
      stream().open();
      stream().send({
        event: 'snapshot',
        seq: 1,
        runs: [],
        queues: [queueOf({ repository: APP }), queueOf({ repository: LIB })],
        repositories,
      });
    });
    return api;
  }

  /** Waits until the selector shows a project and opens the list; returns the other project. */
  async function openOther() {
    const select = await screen.findByRole('combobox', { name: 'Project' });
    await waitFor(() => expect(select.textContent).toMatch(/app|lib/));
    const other = select.textContent?.includes('app') ? 'lib' : 'app';
    return {
      other: other === 'lib' ? LIB : APP,
      choose: async () => {
        fireEvent.keyDown(select, { key: 'Enter' });
        fireEvent.click(await screen.findByRole('option', { name: other }));
      },
    };
  }

  it('shows the settings of another project when it is chosen', async () => {
    const api = open('#settings/project/general');
    await screen.findByTestId('setting-max');
    const { other, choose } = await openOther();
    await choose();
    await waitFor(() => expect(api.calls).toContainEqual(['config', other]));
    expect(window.location.hash).toBe('#settings/project/general');
  });

  it('asks about unsaved changes when the project is changed', async () => {
    const api = open('#settings/project/general');
    const { other, choose } = await openOther();
    fireEvent.change(await screen.findByLabelText('Parallel groups'), { target: { value: '9' } });
    await choose();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(api.calls).not.toContainEqual(['config', other]);
  });

  it('says there is no project while the list of repositories is empty', async () => {
    show(queueOf(), {}, '#settings/project/general');
    expect(
      await screen.findByText('No repositories yet: add one in the repository menu.'),
    ).toBeTruthy();
  });
});

describe('system group', () => {
  const flush = (ms = 0) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  /** The state the fake panel answers; the page can mount again, so the tests change it by hand. */
  let current = systemView();
  let down = false;
  const system = () =>
    vi.fn(async () => {
      if (down) throw new Error('down');
      return current;
    });
  const mountSystem = async (overrides: Parameters<typeof fakeApi>[0] = {}) => {
    current = systemView();
    down = false;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = show(queueOf(), { system: system(), ...overrides }, '#settings/system');
    await screen.findByRole('region', { name: 'Daemon' });
    return api;
  };
  const daemonOf = (patch: Partial<ReturnType<typeof systemView>['daemon']>) => ({
    ...systemView().daemon,
    ...patch,
  });
  const card = (name: string) => within(screen.getByRole('region', { name }));
  const click = (name: string, button: string) =>
    act(async () => {
      fireEvent.click(card(name).getByRole('button', { name: button }));
    });
  const confirmIn = async (label: string) => {
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: label }));
    });
  };

  it('shows the cards of the daemon and the panel without the token', async () => {
    await mountSystem();
    const daemon = card('Daemon');
    expect(daemon.getByText('Running')).toBeTruthy();
    expect(daemon.getByText('100')).toBeTruthy();
    expect(daemon.getByText('1.2.3')).toBeTruthy();
    expect(daemon.getByText('abc123')).toBeTruthy();
    expect(daemon.getByText('Idle')).toBeTruthy();
    expect(daemon.getByText('/state/daemon.log')).toBeTruthy();
    const web = card('Web panel');
    expect(web.getByText('http://127.0.0.1:7341/')).toBeTruthy();
    expect(web.getByText('token')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('token=');
  });

  it('reads the state again every 3 seconds and shows the daemon as busy', async () => {
    await mountSystem();
    current = systemView({ daemon: daemonOf({ busy: true }) });
    expect(card('Daemon').getByText('Idle')).toBeTruthy();
    await flush(3100);
    expect(card('Daemon').getByText('Busy')).toBeTruthy();
  });

  it('says there is no connection when the panel does not answer', async () => {
    await mountSystem();
    down = true;
    await flush(3100);
    expect(screen.getByText('No connection to the panel')).toBeTruthy();
    expect(card('Daemon').getByText('Running')).toBeTruthy();
  });

  it('warns about builds that differ', async () => {
    current = systemView({ daemon: daemonOf({ mismatch: 'daemon' }) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show(queueOf(), { system: vi.fn(async () => current) }, '#settings/system');
    await screen.findByText(/older build than the panel/);
  });

  it('restarts the panel after a confirmation and waits until it answers', async () => {
    const api = await mountSystem();
    await click('Web panel', 'Restart panel');
    expect(api.restartWeb).not.toHaveBeenCalled();
    await confirmIn('Restart');
    expect(api.restartWeb).toHaveBeenCalledTimes(1);
    down = true;
    expect(card('Web panel').getByRole('button', { name: 'Restarting…' })).toBeTruthy();
    expect(
      card('Daemon').getByRole<HTMLButtonElement>('button', { name: 'Restart daemon' }).disabled,
    ).toBe(true);
    await flush(1000);
    expect(card('Web panel').getByRole('button', { name: 'Restarting…' })).toBeTruthy();
    down = false;
    await flush(1000);
    expect(card('Web panel').getByRole('button', { name: 'Restart panel' })).toBeTruthy();
    expect(screen.queryByText(/did not come back/)).toBeNull();
  });

  it('does not restart anything when the confirmation is declined', async () => {
    const api = await mountSystem();
    await click('Web panel', 'Restart panel');
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    });
    expect(api.restartWeb).not.toHaveBeenCalled();
  });

  it('cannot restart a panel started by aip web', async () => {
    current = systemView({ web: { ...systemView().web, servedBy: 'standalone' } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show(queueOf(), { system: vi.fn(async () => current) }, '#settings/system');
    await screen.findByText(/started by the aip web command/);
    expect(
      card('Web panel').getByRole<HTMLButtonElement>('button', { name: 'Restart panel' }).disabled,
    ).toBe(true);
    expect(
      card('Daemon').getByRole<HTMLButtonElement>('button', { name: 'Restart daemon' }).disabled,
    ).toBe(true);
  });

  it('gives up after 30 seconds and points to the log', async () => {
    await mountSystem();
    await click('Web panel', 'Restart panel');
    await confirmIn('Restart');
    down = true;
    await flush(31_000);
    expect(screen.getByText(/did not come back within 30 seconds/).textContent).toContain(
      '/state/daemon.log',
    );
    expect(card('Web panel').getByRole('button', { name: 'Restart panel' })).toBeTruthy();
  });

  it('restarts an idle daemon and waits for a new pid', async () => {
    const api = await mountSystem();
    await click('Daemon', 'Restart daemon');
    await confirmIn('Restart');
    expect(api.restartDaemon).toHaveBeenCalledWith(false);
    await flush(1000);
    expect(card('Daemon').getByRole('button', { name: 'Restarting…' })).toBeTruthy();
    current = systemView({ daemon: daemonOf({ pid: 200 }) });
    await flush(1000);
    expect(card('Daemon').getByRole('button', { name: 'Restart daemon' })).toBeTruthy();
    expect(card('Daemon').getByText('200')).toBeTruthy();
  });

  it('asks again for a busy daemon and restarts it with force', async () => {
    const restartDaemon = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'agents are running', 'daemon_busy'))
      .mockResolvedValue(undefined);
    const api = await mountSystem({ restartDaemon });
    current = systemView({ daemon: daemonOf({ busy: true }) });
    await click('Daemon', 'Restart daemon');
    await confirmIn('Restart');
    expect(api.restartDaemon).toHaveBeenLastCalledWith(false);
    const busy = await screen.findByRole('alertdialog');
    expect(within(busy).getByText('Agents are running')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(busy).getByRole('button', { name: 'Restart, stopping the agents' }));
    });
    expect(api.restartDaemon).toHaveBeenLastCalledWith(true);
    current = systemView({ daemon: daemonOf({ pid: 300 }) });
    await flush(1000);
    expect(card('Daemon').getByText('300')).toBeTruthy();
  });

  it('leaves a busy daemon alone when the person does not override', async () => {
    const restartDaemon = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'agents are running', 'daemon_busy'));
    const api = await mountSystem({ restartDaemon });
    await click('Daemon', 'Restart daemon');
    await confirmIn('Restart');
    const busy = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(busy).getByRole('button', { name: 'Cancel' }));
    });
    expect(api.restartDaemon).toHaveBeenCalledTimes(1);
    expect(card('Daemon').getByRole('button', { name: 'Restart daemon' })).toBeTruthy();
  });
});
