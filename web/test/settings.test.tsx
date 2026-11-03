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

const GROUP_NAMES = [
  'General',
  'Defaults',
  'Delivery',
  'Working copy',
  'Naming',
  'Claude',
  'Runtimes',
  'Web panel',
  'Queue',
  'Tags',
  'System',
];

describe('settings page', () => {
  it('lists eleven groups in the left column and opens General by default', async () => {
    show(queueOf(), {}, '#settings');
    const nav = await screen.findByRole('navigation', { name: 'groups of settings' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(GROUP_NAMES);
    expect(within(nav).getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe(
      'page',
    );
    await waitFor(() => expect(window.location.hash).toBe('#settings/general'));
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('shows a value read only with the file it comes from', async () => {
    show(
      queueOf(),
      {
        config: vi.fn(async () =>
          configView({
            settings: settingsOf({ max: { path: 'max', value: 5, file: GLOBAL_FILE } }),
          }),
        ),
      },
      '#settings/general',
    );
    const max = await screen.findByTestId('setting-max');
    expect(within(max).getByText('5')).toBeTruthy();
    const file = within(max).getByText(GLOBAL_FILE);
    expect(file.className).toContain('bg-muted');
    expect(file.getAttribute('title')).toBe(GLOBAL_FILE);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByTestId('setting-defaults.timeout')).toBeNull();
  });

  it('opens a group by its address and shows only its fields', async () => {
    show(queueOf(), {}, '#settings/web');
    const port = await screen.findByTestId('setting-web.port');
    expect(port.textContent).toContain('7341');
    expect(port.textContent).toContain('default');
    expect(screen.queryByTestId('setting-max')).toBeNull();
  });

  it('falls back to General for an unknown group', async () => {
    show(queueOf(), {}, '#settings/nowhere');
    await screen.findByTestId('setting-max');
    await waitFor(() => expect(window.location.hash).toBe('#settings/general'));
  });

  it('explains Runtimes and Web panel and links to System', async () => {
    for (const group of ['runtimes', 'web']) {
      show(queueOf(), {}, `#settings/${group}`);
      const link = await screen.findByRole('link', { name: 'System' });
      expect(link.getAttribute('href')).toBe('#settings/system');
      expect(screen.getByText(/Changes take effect after the restart/)).toBeTruthy();
      cleanup();
    }
  });

  it('shows the environment of a runtime by names', async () => {
    show(queueOf(), {}, '#settings/runtimes');
    const env = await screen.findByTestId('setting-runtimes.claude.env');
    expect(env.textContent).toContain('ANTHROPIC_API_KEY');
    expect(screen.getByTestId('setting-runtimes.claude.command').textContent).toContain('claude');
  });

  it('marks the group of a configuration error and shows the error in it', async () => {
    const config = vi.fn(async () =>
      configView({
        errors: [{ file: PROJECT_FILE, path: 'swarm.naming.runtime', message: 'unknown runtime' }],
      }),
    );
    show(queueOf(), { config }, '#settings/general');
    const naming = () =>
      within(screen.getByRole('navigation', { name: 'groups of settings' })).getByRole('link', {
        name: /^Naming/,
      });
    await waitFor(() =>
      expect(within(naming()).getByText('the group has configuration errors')).toBeTruthy(),
    );
    expect(
      within(screen.getByRole('navigation', { name: 'groups of settings' })).getByRole('link', {
        name: 'General',
      }).textContent,
    ).toBe('General');
    fireEvent.click(naming());
    const errors = await screen.findByRole('region', { name: 'configuration errors' });
    expect(within(errors).getByText('swarm.naming.runtime')).toBeTruthy();
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
      '#settings/general',
    );
    const errors = await screen.findByRole('region', { name: 'configuration errors' });
    expect(within(errors).getByText('swarm.specialists.coder.model')).toBeTruthy();
  });

  it('shows the catalog of tags in the Tags group', async () => {
    show(queueOf(), {}, '#settings/tags');
    expect(await screen.findByText('The tag catalog is shared by all repositories.')).toBeTruthy();
  });

  it('redirects the old address of the general settings', async () => {
    show(queueOf(), {}, '#specialists/_settings');
    await screen.findByRole('navigation', { name: 'groups of settings' });
    await waitFor(() => expect(window.location.hash).toBe('#settings/general'));
  });

  it('has no General settings entry in the list of specialists', async () => {
    show(queueOf(), {}, '#specialists');
    await screen.findByRole('list', { name: 'specialists' });
    expect(screen.queryByText('General settings')).toBeNull();
  });
});

describe('delivery fields', () => {
  const viewWith = (file: string | null, revisions = FILES) =>
    configView({
      settingsFiles: revisions,
      settings: settingsOf({ 'delivery.auto': { path: 'delivery.auto', value: true, file } }),
    });
  const autoSwitch = () =>
    waitFor(() => {
      const found = screen.getByRole<HTMLButtonElement>('switch', {
        name: 'Auto delivery by default',
      });
      expect(found.disabled).toBe(false);
      return found;
    });
  const pickMode = async (name: string) => {
    const select = await waitFor(() => {
      const found = screen.getByRole<HTMLButtonElement>('combobox', { name: 'Delivery mode' });
      expect(found.disabled).toBe(false);
      return found;
    });
    fireEvent.keyDown(select, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name }));
  };

  it('writes delivery.auto to the global file with its revision and reads the view again', async () => {
    const config = vi
      .fn()
      .mockResolvedValueOnce(viewWith(null))
      .mockResolvedValue(viewWith(GLOBAL_FILE));
    const api = show(queueOf(), { config }, '#settings/delivery');
    const toggle = await autoSwitch();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.auto', false, 'g1', 'global'),
    );
    await waitFor(() => expect(vi.mocked(api.config).mock.calls.length).toBeGreaterThan(1));
  });

  it('writes a value of the project file back to the project file', async () => {
    const api = show(
      queueOf(),
      { config: vi.fn(async () => viewWith(PROJECT_FILE)) },
      '#settings/delivery',
    );
    const toggle = await autoSwitch();
    expect(screen.getByText(`Saved to the project file: ${PROJECT_FILE}`)).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.auto', false, 'p1', 'project'),
    );
  });

  it('writes two settings in a row with the re-read revision', async () => {
    let revision = 'g1';
    const api = show(
      queueOf(),
      {
        config: vi.fn(async () =>
          viewWith(null, { ...FILES, global: { ...FILES.global, revision } }),
        ),
        writeSetting: vi.fn(async () => {
          revision = 'g2';
          return { ok: true as const, revision: 'g2' };
        }),
      },
      '#settings/delivery',
    );
    const reads = vi.mocked(api.config).mock.calls.length;
    fireEvent.click(await autoSwitch());
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.auto', false, 'g1', 'global'),
    );
    await waitFor(() => expect(vi.mocked(api.config).mock.calls.length).toBeGreaterThan(reads));
    await pickMode('Branch');
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.mode', 'branch', 'g2', 'global'),
    );
  });

  it('shows a write conflict and keeps the previous value', async () => {
    show(
      queueOf(),
      {
        config: vi.fn(async () => viewWith(null)),
        writeSetting: vi.fn(async () => ({
          ok: false as const,
          reason: 'conflict' as const,
          message: 'settings.yaml was changed after it was read',
        })),
      },
      '#settings/delivery',
    );
    fireEvent.click(await autoSwitch());
    await screen.findByText(/was changed after it was read/);
    expect(
      screen.getByRole('switch', { name: 'Auto delivery by default' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('is unavailable while the configuration has errors', async () => {
    show(
      queueOf(),
      {
        config: vi.fn(async () =>
          configView({ errors: [{ file: PROJECT_FILE, path: 'swarm.max', message: 'bad' }] }),
        ),
      },
      '#settings/delivery',
    );
    await screen.findByRole('switch', { name: 'Auto delivery by default' });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('switch', { name: 'Auto delivery by default' })
          .disabled,
      ).toBe(true),
    );
    expect(
      screen.getByRole<HTMLButtonElement>('combobox', { name: 'Delivery mode' }).disabled,
    ).toBe(true);
  });

  it('does not make the other fields of the group writable', async () => {
    show(queueOf(), {}, '#settings/delivery');
    await screen.findByTestId('setting-delivery.keep');
    expect(screen.queryByTestId('setting-delivery.auto')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
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
