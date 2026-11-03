// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import type { Api } from '../src/api.ts';
import SpecialistsPage from '../src/components/SpecialistsPage.tsx';
import { valueOf } from '../src/components/SpecialistForm.tsx';
import { formatRoute, parseRoute } from '../src/route.ts';

import {
  catalogView,
  configView,
  fakeApi,
  openFake,
  settingsOf,
  specialistEntry,
} from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Page({ api, start = null }: { api: Api; start?: string | null }) {
  const [selected, setSelected] = useState<string | null>(start);
  return <SpecialistsPage api={api} selected={selected} onSelect={setSelected} />;
}

const twoLevels = () =>
  configView({
    specialists: [
      specialistEntry('coder'),
      specialistEntry('qa', {
        level: 'global',
        file: '/xdg/aip/specialists/qa.yaml',
        revision: null,
      }),
      specialistEntry('plan', { level: 'project_over_global' }),
    ],
    settings: settingsOf({
      max: { path: 'max', value: 5, file: '/xdg/aip/settings.yaml' },
    }),
  });

describe('routes', () => {
  it('reads and writes the specialists addresses', () => {
    expect(parseRoute('#specialists')).toEqual({
      view: 'specialists',
      run: null,
      group: null,
      step: null,
    });
    expect(parseRoute('#specialists/coder').run).toBe('coder');
    expect(parseRoute('#specialists/new').run).toBe('new');
    expect(formatRoute({ view: 'specialists', run: 'coder', group: null, step: null })).toBe(
      '#specialists/coder',
    );
    expect(formatRoute({ view: 'specialists', run: null, group: null, step: null })).toBe(
      '#specialists',
    );
  });
});

describe('general settings switch', () => {
  const viewWith = (file: string | null) =>
    configView({
      settings: settingsOf({ 'delivery.auto': { path: 'delivery.auto', value: true, file } }),
    });

  it('writes delivery.auto to the global level with the revision and reads the view again', async () => {
    const config = vi
      .fn()
      .mockResolvedValueOnce(viewWith(null))
      .mockResolvedValue(
        configView({
          settings: settingsOf({
            'delivery.auto': {
              path: 'delivery.auto',
              value: false,
              file: '/xdg/aip/settings.yaml',
            },
          }),
        }),
      );
    const api = fakeApi({ config });
    render(<Page api={api} start="_settings" />);
    const toggle = await screen.findByRole('switch', { name: 'delivery.auto' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('delivery.auto', false, 'g1', 'global'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'delivery.auto' }).getAttribute('aria-checked'),
      ).toBe('false'),
    );
  });

  it('is disabled when the project file sets the value', async () => {
    render(
      <Page
        api={fakeApi({ config: vi.fn(async () => viewWith('/repo/aip/settings.yaml')) })}
        start="_settings"
      />,
    );
    const toggle = await screen.findByRole<HTMLButtonElement>('switch', { name: 'delivery.auto' });
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText('set by the project file')).toBeTruthy();
  });

  it('shows the conflict and keeps the previous value', async () => {
    const api = fakeApi({
      config: vi.fn(async () => viewWith(null)),
      writeSetting: vi.fn(async () => ({
        ok: false as const,
        reason: 'conflict' as const,
        message: 'settings.yaml was changed after it was read',
      })),
    });
    render(<Page api={api} start="_settings" />);
    fireEvent.click(await screen.findByRole('switch', { name: 'delivery.auto' }));
    await screen.findByText(/was changed after it was read/);
    expect(screen.getByRole('switch', { name: 'delivery.auto' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('does not make other settings switchable', async () => {
    render(<Page api={fakeApi({ config: vi.fn(async () => twoLevels()) })} start="_settings" />);
    await screen.findByTestId('setting-max');
    expect(screen.queryByRole('switch', { name: 'max' })).toBeNull();
  });
});

describe('specialists list', () => {
  it('shows the level of each specialist', async () => {
    render(<Page api={fakeApi({ config: vi.fn(async () => twoLevels()) })} />);
    await screen.findByText('coder');
    const list = screen.getByRole('list', { name: 'specialists' });
    const row = (slug: string) => within(list).getByText(slug).closest('li')!;
    expect(within(row('coder')).getByText('project')).toBeTruthy();
    expect(within(row('qa')).getByText('global')).toBeTruthy();
    expect(within(row('plan')).getByText('project over global')).toBeTruthy();
  });

  it('shows the errors above the list with their files', async () => {
    const view = configView({
      errors: [
        {
          file: '/repo/aip/workflows/feature.yaml',
          path: 'swarm.workflows.feature.steps[0].specialist',
          message: 'unknown specialist',
        },
      ],
    });
    render(<Page api={fakeApi({ config: vi.fn(async () => view) })} />);
    const errors = await screen.findByRole('region', { name: 'configuration errors' });
    expect(within(errors).getByText('/repo/aip/workflows/feature.yaml')).toBeTruthy();
    expect(within(errors).getByText('swarm.workflows.feature.steps[0].specialist')).toBeTruthy();
  });

  it('shows the settings read only with the file of each field', async () => {
    render(<Page api={fakeApi({ config: vi.fn(async () => twoLevels()) })} start="_settings" />);
    const max = await screen.findByTestId('setting-max');
    expect(within(max).getByText('5')).toBeTruthy();
    expect(within(max).getByText('/xdg/aip/settings.yaml')).toBeTruthy();
    expect(screen.getByTestId('setting-defaults.timeout').textContent).toContain('default');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('specialist form', () => {
  it('shows the value inherited from defaults as a hint', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    const permissions = await screen.findByRole('combobox', { name: 'Permissions' });
    expect(permissions.textContent).toBe('edit (from defaults)');
    fireEvent.keyDown(permissions, { key: 'Enter' });
    expect(await screen.findByRole('option', { name: 'edit (from defaults)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'full' })).toBeTruthy();
    expect((screen.getByLabelText('Timeout') as HTMLInputElement).placeholder).toBe(
      '30m (from defaults)',
    );
  });

  it('sends only the changed field, with the revision, and says that new runs get it', async () => {
    const writeSpecialist = vi.fn(async () => ({
      ok: true as const,
      revision: 'next',
      file: '/f',
    }));
    render(<Page api={fakeApi({ writeSpecialist })} start="coder" />);
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'opus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist).toHaveBeenCalledWith(
      'coder',
      { name: 'Кодировщик', model: 'opus' },
      'rev-coder',
      'project',
    );
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      expect.stringContaining('new runs'),
    );
  });

  it('shows a validation error at the field and keeps the entered values', async () => {
    const writeSpecialist = vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [
        {
          file: '/repo/aip/specialists/coder.yaml',
          path: 'swarm.specialists.coder.timeout',
          message: 'must be a positive duration such as 90s, 30m or 2h',
        },
      ],
    }));
    render(<Page api={fakeApi({ writeSpecialist })} start="coder" />);
    fireEvent.change(await screen.findByLabelText('Timeout'), { target: { value: 'полчаса' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const field = (await screen.findByLabelText('Timeout')).closest('div')!;
    expect(await within(field as HTMLElement).findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('positive duration'),
    );
    expect((screen.getByLabelText('Timeout') as HTMLInputElement).value).toBe('полчаса');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('opus');
  });

  it('offers to reread after a conflict and asks before dropping the typed values', async () => {
    const writeSpecialist = vi.fn(async () => ({
      ok: false as const,
      reason: 'conflict' as const,
      message: '/repo/aip/specialists/coder.yaml was changed after it was read',
    }));
    const config = vi.fn(async () => configView());
    render(<Page api={fakeApi({ writeSpecialist, config })} start="coder" />);
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'opus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const reread = await screen.findByRole('button', { name: 'Reread the specialist' });
    expect(config).toHaveBeenCalledTimes(1);
    fireEvent.click(reread);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('The entered values will be lost');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(config).toHaveBeenCalledTimes(1);
    fireEvent.click(reread);
    fireEvent.click(await screen.findByRole('button', { name: 'Reread' }));
    await waitFor(() => expect(config).toHaveBeenCalledTimes(2));
  });

  it('asks before leaving a specialist with unsaved edits', async () => {
    const view = configView({ specialists: [specialistEntry('coder'), specialistEntry('plan')] });
    render(<Page api={fakeApi({ config: vi.fn(async () => view) })} start="coder" />);
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'opus' } });
    const list = screen.getByRole('list', { name: 'specialists' });
    fireEvent.click(within(list).getByText('plan'));
    fireEvent.click(await screen.findByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'coder' })).toBeTruthy();
    fireEvent.click(within(list).getByText('plan'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'plan' })).toBeTruthy();
  });

  it('removes a cleared field from the value', () => {
    const raw = { name: 'Кодировщик', timeout: '1h', model: 'sonnet', color: 'red' };
    const draft = {
      name: 'Кодировщик',
      runtime: '',
      model: 'sonnet',
      permissions: '',
      timeout: '',
      allow_commands: [],
      tools: [],
      skills: ['a', '', ' b '],
      max: '2',
      prompt: '',
    };
    expect(valueOf(draft, raw)).toEqual({
      name: 'Кодировщик',
      model: 'sonnet',
      color: 'red',
      skills: ['a', 'b'],
      max: 2,
    });
    expect(Object.keys(valueOf(draft, raw))).toEqual(['name', 'model', 'color', 'skills', 'max']);
  });
});

describe('creating, copying and deleting', () => {
  it('creates a specialist from an empty form with a slug', async () => {
    const writeSpecialist = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={fakeApi({ writeSpecialist })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New specialist' }));
    const save = await screen.findByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'qa' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'QA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writeSpecialist).toHaveBeenCalledWith('qa', { name: 'QA' }, null, 'project'),
    );
  });

  it('saves the form as a new specialist without touching the original', async () => {
    const writeSpecialist = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={fakeApi({ writeSpecialist })} start="coder" />);
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'haiku' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as…' }));
    fireEvent.change(screen.getByLabelText('New slug'), { target: { value: 'coder-fast' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create a copy' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalledTimes(1));
    expect(writeSpecialist).toHaveBeenCalledWith(
      'coder-fast',
      { name: 'Кодировщик', model: 'haiku' },
      null,
      'project',
    );
  });

  it('announces the deletion of a specialist', async () => {
    const deleteSpecialist = vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' }));
    const view = configView({ specialists: [specialistEntry('reviewer')] });
    render(
      <Page
        api={fakeApi({ deleteSpecialist, config: vi.fn(async () => view) })}
        start="reviewer"
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteSpecialist).toHaveBeenCalled());
    expect((await screen.findAllByText('Specialist «reviewer» deleted')).length).toBeGreaterThan(0);
  });

  it('lists the references when the specialist is in use', async () => {
    const deleteSpecialist = vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [],
      references: [{ workflow: 'feature', step: 'review' }, { field: 'delivery.resolver' }],
    }));
    const view = configView({ specialists: [specialistEntry('reviewer')] });
    render(
      <Page
        api={fakeApi({ deleteSpecialist, config: vi.fn(async () => view) })}
        start="reviewer"
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('The file');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const alert = await screen.findByText('The specialist is used by:');
    const box = alert.closest('[role="alert"]') as HTMLElement;
    expect(within(box).getByText('feature → review')).toBeTruthy();
    expect(within(box).getByText('delivery.resolver')).toBeTruthy();
    expect(deleteSpecialist).toHaveBeenCalledWith('reviewer', 'rev-reviewer', 'project');
    expect(
      within(screen.getByRole('list', { name: 'specialists' })).getByText('reviewer'),
    ).toBeTruthy();
  });

  it('opens a global specialist for editing and writes it with level global', async () => {
    const writeSpecialist = vi.fn(async () => ({ ok: true as const, revision: 'n', file: '/f' }));
    const config = vi.fn(async () =>
      configView({
        specialists: [
          specialistEntry('qa', { level: 'global', file: '/xdg/aip/specialists/qa.yaml' }),
        ],
      }),
    );
    render(<Page api={fakeApi({ config, writeSpecialist })} start="qa" />);
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    expect(name.disabled).toBe(false);
    expect(screen.getByText(/applies in every repository/)).toBeTruthy();
    fireEvent.change(name, { target: { value: 'QA2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writeSpecialist).toHaveBeenCalledWith('qa', { name: 'QA2' }, 'rev-qa', 'global'),
    );
  });

  it('overrides a global specialist in the project', async () => {
    let level: 'global' | 'project_over_global' = 'global';
    const config = vi.fn(async () =>
      configView({
        specialists: [
          specialistEntry('qa', {
            level,
            revision: level === 'global' ? null : 'rev-qa',
            file:
              level === 'global' ? '/xdg/aip/specialists/qa.yaml' : '/repo/aip/specialists/qa.yaml',
          }),
        ],
      }),
    );
    const writeSpecialist = vi.fn(async () => {
      level = 'project_over_global';
      return { ok: true as const, revision: 'rev-qa', file: '/repo/aip/specialists/qa.yaml' };
    });
    render(<Page api={fakeApi({ config, writeSpecialist })} start="qa" />);
    await screen.findByLabelText('Name');
    expect(screen.queryByRole('radio', { name: 'Project' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Override in the project' }));
    await waitFor(() =>
      expect(writeSpecialist).toHaveBeenCalledWith('qa', { name: 'QA' }, null, 'project'),
    );
    expect(await screen.findByRole('button', { name: 'Remove the override' })).toBeTruthy();
    expect(screen.getAllByText('project over global').length).toBeGreaterThan(1);
  });

  it('makes a project specialist global', async () => {
    const writeSpecialist = vi.fn(async () => ({ ok: true as const, revision: 'n', file: '/f' }));
    render(<Page api={fakeApi({ writeSpecialist })} start="coder" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make global' }));
    await waitFor(() =>
      expect(writeSpecialist).toHaveBeenCalledWith(
        'coder',
        expect.objectContaining({ name: expect.any(String) }),
        null,
        'global',
      ),
    );
  });

  it('creates a new specialist on the global level', async () => {
    const writeSpecialist = vi.fn(async () => ({ ok: true as const, revision: 'n', file: '/f' }));
    render(<Page api={fakeApi({ writeSpecialist })} start="new" />);
    fireEvent.change(await screen.findByLabelText('Slug'), { target: { value: 'qa' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writeSpecialist).toHaveBeenCalledWith('qa', expect.anything(), null, 'global'),
    );
  });

  it('switches between the levels of a specialist that has both, and deletes on the chosen one', async () => {
    const deleteSpecialist = vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' }));
    const config = vi.fn(async () =>
      configView({
        specialists: [
          specialistEntry('qa', {
            level: 'project_over_global',
            raw: { name: 'Проект' },
            sources: {
              project: {
                file: '/repo/aip/specialists/qa.yaml',
                revision: 'p',
                raw: { name: 'Проект' },
              },
              global: {
                file: '/xdg/aip/specialists/qa.yaml',
                revision: 'g',
                raw: { name: 'Общий' },
              },
            },
          }),
        ],
      }),
    );
    render(<Page api={fakeApi({ config, deleteSpecialist })} start="qa" />);
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    expect(name.value).toBe('Проект');
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Общий'),
    );
    expect(screen.getByText(/the project file overrides it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete', hidden: false }));
    await waitFor(() => expect(deleteSpecialist).toHaveBeenCalledWith('qa', 'g', 'global'));
  });

  it('asks before switching the level with unsaved edits', async () => {
    const config = vi.fn(async () =>
      configView({
        specialists: [
          specialistEntry('qa', {
            level: 'project_over_global',
            sources: {
              project: { file: '/p', revision: 'p', raw: { name: 'Проект' } },
              global: { file: '/g', revision: 'g', raw: { name: 'Общий' } },
            },
          }),
        ],
      }),
    );
    render(<Page api={fakeApi({ config })} start="qa" />);
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Правка' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stay' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Правка');
  });
});

describe('the tab', () => {
  it('opens the form of the specialist from the address', async () => {
    window.location.hash = '#specialists/coder';
    render(<App api={fakeApi()} openStream={openFake} />);
    const tab = screen.getByRole('link', { name: 'Specialists' });
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(await screen.findByRole('heading', { name: 'coder' })).toBeTruthy();
    expect(window.location.hash).toBe('#specialists/coder');
  });

  it('switches to the tab from the runs', async () => {
    render(<App api={fakeApi()} openStream={openFake} />);
    fireEvent.click(screen.getByRole('link', { name: 'Specialists' }));
    expect(await screen.findByRole('button', { name: 'New specialist' })).toBeTruthy();
    expect(window.location.hash).toBe('#specialists');
  });
});

describe('tools and skills', () => {
  const reviewer = (raw: Record<string, unknown>) =>
    configView({
      specialists: [specialistEntry('reviewer', { raw: { name: 'Ревьюер', ...raw } })],
    });
  const okWrite = () =>
    vi.fn(async (..._args: unknown[]) => ({ ok: true as const, revision: 'n', file: '/f' }));
  const open = async (name: string) => {
    fireEvent.click(await screen.findByRole('combobox', { name }));
    return screen.findByRole('combobox', { name: new RegExp(`Search in ${name}`) });
  };

  it('loads the catalog when opened and when reread', async () => {
    const catalog = vi.fn(async () => catalogView());
    const writeSpecialist = vi.fn(async () => ({
      ok: false as const,
      reason: 'conflict' as const,
      message: 'changed after it was read',
    }));
    render(<Page api={fakeApi({ catalog, writeSpecialist })} start="coder" />);
    await screen.findByLabelText('Model');
    expect(catalog).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reread the specialist' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reread' }));
    await waitFor(() => expect(catalog).toHaveBeenCalledTimes(2));
  });

  it('picks a skill from the catalog and saves it', async () => {
    const writeSpecialist = okWrite();
    render(
      <Page
        api={fakeApi({ writeSpecialist, config: vi.fn(async () => reviewer({})) })}
        start="reviewer"
      />,
    );
    const search = await open('Skills');
    fireEvent.change(search, { target: { value: 'rev' } });
    fireEvent.click((await screen.findAllByRole('option', { name: /review/ }))[0]!);
    expect(screen.getByRole('button', { name: 'Remove review' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist.mock.calls[0]).toEqual([
      'reviewer',
      { name: 'Ревьюер', skills: ['review'] },
      'rev-reviewer',
      'project',
    ]);
  });

  it('offers a skill of two levels in both groups and gives one chip', async () => {
    render(<Page api={fakeApi({ config: vi.fn(async () => reviewer({})) })} start="reviewer" />);
    const search = await open('Skills');
    fireEvent.change(search, { target: { value: 'review' } });
    const options = await screen.findAllByRole('option', { name: /review/ });
    expect(options).toHaveLength(2);
    expect(screen.getByText('Project')).toBeTruthy();
    expect(screen.getByText('Shared')).toBeTruthy();
    fireEvent.click(options[0]!);
    fireEvent.click(screen.getAllByRole('option', { name: /review/ })[1]!);
    expect(screen.getAllByRole('button', { name: 'Remove review' })).toHaveLength(1);
  });

  it('marks a skill that is not in the catalog and saves the file unchanged', async () => {
    const writeSpecialist = okWrite();
    render(
      <Page
        api={fakeApi({
          writeSpecialist,
          config: vi.fn(async () => reviewer({ skills: ['grill-me'] })),
        })}
        start="reviewer"
      />,
    );
    expect(await screen.findByText('grill-me')).toBeTruthy();
    expect(screen.getByText('not found')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist.mock.calls[0]![1]).toEqual({ name: 'Ревьюер', skills: ['grill-me'] });
  });

  it('shows tools of defaults as grey chips and does not write them', async () => {
    const writeSpecialist = okWrite();
    const view = configView({
      settings: settingsOf({
        'defaults.tools': { path: 'defaults.tools', value: ['WebFetch'], file: null },
      }),
    });
    render(
      <Page api={fakeApi({ writeSpecialist, config: vi.fn(async () => view) })} start="coder" />,
    );
    const chip = (await screen.findByText('from defaults')).closest('[data-inherited]')!;
    expect(chip.textContent).toContain('WebFetch');
    expect(within(chip as HTMLElement).queryByRole('button')).toBeNull();
    const search = await open('Tools');
    fireEvent.change(search, { target: { value: 'WebSearch' } });
    fireEvent.click(await screen.findByRole('option', { name: /WebSearch/ }));
    await waitFor(() => expect(screen.queryByText('from defaults')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist.mock.calls[0]![1]).toMatchObject({ tools: ['WebSearch'] });
  });

  it('does not add tools to the file when the inherited ones are untouched', async () => {
    const writeSpecialist = okWrite();
    const view = configView({
      settings: settingsOf({
        'defaults.tools': { path: 'defaults.tools', value: ['WebFetch'], file: null },
      }),
    });
    render(
      <Page api={fakeApi({ writeSpecialist, config: vi.fn(async () => view) })} start="coder" />,
    );
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'opus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist.mock.calls[0]![1]).not.toHaveProperty('tools');
  });

  it('marks an MCP tool when the user settings are isolated', async () => {
    render(<Page api={fakeApi({ config: vi.fn(async () => reviewer({})) })} start="reviewer" />);
    const search = await open('Tools');
    fireEvent.change(search, { target: { value: 'jira' } });
    fireEvent.click(await screen.findByRole('option', { name: /mcp__jira/ }));
    fireEvent.keyDown(search, { key: 'Escape' });
    const remove = await screen.findByRole('button', { name: 'Remove mcp__jira' });
    expect(remove.closest('[class*="gap-1.5"]')!.textContent).toMatch(
      /until claude.mcp is inherit/,
    );
  });

  it('does not mark an MCP tool when the user settings are inherited', async () => {
    const view = configView({
      specialists: [specialistEntry('reviewer', { raw: { name: 'Ревьюер' } })],
    });
    const catalog = vi.fn(async () => catalogView({ mcpInherited: true }));
    render(<Page api={fakeApi({ catalog, config: vi.fn(async () => view) })} start="reviewer" />);
    const search = await open('Tools');
    fireEvent.change(search, { target: { value: 'jira' } });
    fireEvent.click(await screen.findByRole('option', { name: /mcp__jira/ }));
    expect(screen.queryByText(/until claude.mcp is inherit/)).toBeNull();
  });

  it('adds a command once and writes it as allow_commands', async () => {
    const writeSpecialist = okWrite();
    render(
      <Page
        api={fakeApi({ writeSpecialist, config: vi.fn(async () => reviewer({})) })}
        start="reviewer"
      />,
    );
    const search = await open('Allowed commands');
    for (let i = 0; i < 2; i++) {
      fireEvent.change(search, { target: { value: 'npm run check' } });
      fireEvent.keyDown(search, { key: 'Enter' });
    }
    expect(screen.getAllByRole('button', { name: 'Remove npm run check' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist.mock.calls[0]![1]).toMatchObject({ allow_commands: ['npm run check'] });
  });

  it('keeps the fields usable and says so when the catalog fails', async () => {
    const catalog = vi.fn(async () => {
      throw new Error('no catalog');
    });
    render(
      <Page
        api={fakeApi({ catalog, config: vi.fn(async () => reviewer({ skills: ['x'] })) })}
        start="reviewer"
      />,
    );
    expect(await screen.findByText(/did not load \(no catalog\)/)).toBeTruthy();
    expect(screen.queryByText('not found')).toBeNull();
    const search = await open('Skills');
    fireEvent.change(search, { target: { value: 'manual' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Remove manual' })).toBeTruthy();
  });

  it('asks before leaving after a list was edited', async () => {
    render(<Page api={fakeApi({ config: vi.fn(async () => reviewer({})) })} start="reviewer" />);
    const search = await open('Skills');
    fireEvent.change(search, { target: { value: 'manual' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.click(screen.getByText('New specialist'));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });
});

describe('form layout', () => {
  it('groups the fields into sections', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    await screen.findByLabelText('Model');
    const inSection = (section: string, field: string) =>
      within(screen.getByRole('region', { name: section })).getByLabelText(field);
    expect(inSection('Basics', 'Model')).toBeTruthy();
    expect(inSection('Permissions and limits', 'Allowed commands')).toBeTruthy();
    expect(inSection('Tools and skills', 'Skills')).toBeTruthy();
    expect(inSection('Prompt', 'Prompt')).toBeTruthy();
    expect(screen.getByText('How long one attempt may take, such as 90s, 30m or 2h.')).toBeTruthy();
  });

  it('keeps the actions and the level in the sticky header', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    const header = await screen.findByRole('toolbar', { name: 'specialist actions' });
    expect(header.className).toContain('sticky');
    expect(header.className).toContain('-top-4');
    expect(header.className).toContain('-mt-4');
    expect(within(header).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(header).getByText('project')).toBeTruthy();
    expect(within(header).getByRole('heading', { name: 'coder' })).toBeTruthy();
  });

  it('puts the level toggle on its own row above the buttons', async () => {
    const config = vi.fn(async () =>
      configView({
        specialists: [
          specialistEntry('qa', {
            level: 'project_over_global',
            raw: { name: 'Проект' },
            sources: {
              project: { file: '/repo/aip/specialists/qa.yaml', revision: 'p', raw: { name: 'П' } },
              global: { file: '/xdg/aip/specialists/qa.yaml', revision: 'g', raw: { name: 'О' } },
            },
          }),
        ],
      }),
    );
    render(<Page api={fakeApi({ config })} start="qa" />);
    const header = await screen.findByRole('toolbar', { name: 'specialist actions' });
    const radio = within(header).getByRole('radio', { name: 'Project' });
    const heading = within(header).getByRole('heading', { name: 'qa' });
    const save = within(header).getByRole('button', { name: 'Save' });
    expect(heading.parentElement?.contains(radio)).toBe(false);
    expect(save.parentElement?.contains(radio)).toBe(false);
    expect(radio.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the file path as a code chip with the full path in the title', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    const header = await screen.findByRole('toolbar', { name: 'specialist actions' });
    const chip = header.querySelector('code');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toBe('/repo/aip/specialists/coder.yaml');
    expect(chip?.getAttribute('title')).toBe('/repo/aip/specialists/coder.yaml');
    expect(chip?.className).toContain('bg-muted');
  });

  it('renders no level toggle for a specialist with a single level', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    const header = await screen.findByRole('toolbar', { name: 'specialist actions' });
    expect(within(header).queryByRole('radio')).toBeNull();
    expect(within(header).queryByRole('radiogroup')).toBeNull();
    const heading = within(header).getByRole('heading', { name: 'coder' });
    const save = within(header).getByRole('button', { name: 'Save' });
    expect(heading.parentElement?.contains(save)).toBe(false);
    expect(save.parentElement?.previousElementSibling).toBe(heading.parentElement);
  });
});

describe('form width', () => {
  it('has no centred width limit on the root of the form', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    const root = await screen.findByRole('region', { name: 'specialist coder' });
    expect(root.className).not.toMatch(/max-w-|mx-auto/);
  });
});
