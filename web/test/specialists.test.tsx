// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';
import SpecialistsPage from '../src/features/specialists/SpecialistsPage.tsx';
import { valueOf } from '../src/features/specialists/form/SpecialistForm.tsx';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';

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
      tab: null,
    });
    expect(parseRoute('#specialists/coder').run).toBe('coder');
    expect(parseRoute('#specialists/new').run).toBe('new');
    expect(
      formatRoute({ view: 'specialists', run: 'coder', group: null, step: null, tab: null }),
    ).toBe('#specialists/coder');
    expect(
      formatRoute({ view: 'specialists', run: null, group: null, step: null, tab: null }),
    ).toBe('#specialists');
  });
});

describe('specialists list', () => {
  it('shows the level of each specialist', async () => {
    render(<Page api={fakeApi({ config: vi.fn(async () => twoLevels()) })} />);
    await screen.findByText('CODER');
    const list = screen.getByRole('list', { name: 'specialists' });
    const row = (slug: string) => within(list).getByText(slug.toUpperCase()).closest('li')!;
    expect(within(row('coder')).getByText('project')).toBeTruthy();
    expect(within(row('qa')).getByText('global')).toBeTruthy();
    expect(within(row('plan')).getByText('project over global')).toBeTruthy();
    expect(within(row('coder')).getByText(/^coder · /)).toBeTruthy();
  });

  it('shows the errors above the list with their files', async () => {
    const view = configView({
      errors: [
        {
          file: '/repo/aip/pipelines/feature.yaml',
          path: 'swarm.pipelines.feature.steps[0].specialist',
          message: 'unknown specialist',
        },
      ],
    });
    render(<Page api={fakeApi({ config: vi.fn(async () => view) })} />);
    const errors = await screen.findByRole('region', { name: 'configuration errors' });
    expect(within(errors).getByText('/repo/aip/pipelines/feature.yaml')).toBeTruthy();
    expect(within(errors).getByText('swarm.pipelines.feature.steps[0].specialist')).toBeTruthy();
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
    fireEvent.click(within(list).getByText('PLAN'));
    fireEvent.click(await screen.findByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'coder' })).toBeTruthy();
    fireEvent.click(within(list).getByText('PLAN'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'plan' })).toBeTruthy();
  });

  it('removes a cleared field from the value', () => {
    const raw = { name: 'Кодировщик', timeout: '1h', model: 'sonnet', color: 'red' };
    const draft = {
      name: 'Кодировщик',
      runtime: '',
      model: 'sonnet',
      variant: '',
      reasoning_effort: '',
      permissions: '',
      timeout: '',
      allow_commands: [],
      tools: [],
      skills: ['a', '', ' b '],
      max: '2',
      prompt: '',
      tags: [],
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
      references: [{ pipeline: 'feature', step: 'review' }, { field: 'delivery.resolver' }],
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
      within(screen.getByRole('list', { name: 'specialists' })).getByText('REVIEWER'),
    ).toBeTruthy();
  });

  it('opens a global specialist read only, without save and remove', async () => {
    const writeSpecialist = vi.fn();
    const config = vi.fn(async () =>
      configView({
        specialists: [
          specialistEntry('qa', { level: 'global', file: '/xdg/aip/specialists/qa.yaml' }),
        ],
      }),
    );
    render(<Page api={fakeApi({ config, writeSpecialist })} start="qa" />);
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(screen.getByText(/shared specialist: it is view only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Override in the project' })).toBeTruthy();
    expect(writeSpecialist).not.toHaveBeenCalled();
  });

  it('keeps a project specialist editable', async () => {
    render(<Page api={fakeApi({ config: async () => twoLevels() })} start="coder" />);
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    expect(name.disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByText(/shared specialist: it is view only/)).toBeNull();
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
    // the shared file is view only: it cannot be deleted from here
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Project' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Проект'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Remove the override|Delete/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Remove the override|Delete/, hidden: false }),
    );
    await waitFor(() => expect(deleteSpecialist).toHaveBeenCalledWith('qa', 'p', 'project'));
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

  it('uses the Antigravity skill catalog for a specialist with runtime agy', async () => {
    const catalog = vi.fn(async () =>
      catalogView({
        runtimes: {
          ...catalogView().runtimes,
          agy: { tools: [], skills: [{ name: 'antigravity-review', source: 'project' }] },
        },
      }),
    );
    render(
      <Page
        api={fakeApi({ catalog, config: vi.fn(async () => reviewer({ runtime: 'agy' })) })}
        start="reviewer"
      />,
    );
    const search = await open('Skills');
    fireEvent.change(search, { target: { value: 'antigravity' } });
    expect(await screen.findByRole('option', { name: /antigravity-review/ })).toBeTruthy();
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

  it('does not apply Claude MCP inheritance hints to agy tools', async () => {
    const catalog = vi.fn(async () => catalogView());
    render(
      <Page
        api={fakeApi({
          catalog,
          config: vi.fn(async () => reviewer({ runtime: 'agy', tools: ['mcp__jira'] })),
        })}
        start="reviewer"
      />,
    );
    expect(await screen.findByRole('button', { name: 'Remove mcp__jira' })).toBeTruthy();
    expect(screen.queryByText(/until claude.mcp is inherit/)).toBeNull();
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

  it('lays the sections out two per row on a wide form', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    await screen.findByLabelText('Model');
    const names = ['Basics', 'Permissions and limits', 'Tools and skills', 'Prompt'];
    const cards = names.map((n) => screen.getByRole('region', { name: n }).parentElement!);
    const grid = cards[0]!.parentElement!;
    expect(cards.every((c) => c.parentElement === grid)).toBe(true);
    expect(Array.from(grid.children)).toEqual(cards);
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('@3xl:grid-cols-2');
    expect(grid.parentElement!.className).toContain('@container');
    expect(cards.some((c) => c.className.includes('col-span'))).toBe(false);
    expect(grid.contains(screen.getByRole('toolbar', { name: 'specialist actions' }))).toBe(false);
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

  it('puts the file path on its own line under the heading, before the buttons', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    const header = await screen.findByRole('toolbar', { name: 'specialist actions' });
    const heading = within(header).getByRole('heading', { name: 'coder' });
    const chip = header.querySelector('code')!;
    expect(heading.parentElement!.contains(chip)).toBe(false);
    expect(heading.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const save = within(header).getByRole('button', { name: 'Save' });
    expect(chip.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chip.className).toContain('truncate');
  });

  it('shows no file path for a new specialist', async () => {
    render(<Page api={fakeApi()} start="new" />);
    const header = await screen.findByRole('toolbar', { name: 'specialist actions' });
    expect(header.querySelector('code')).toBeNull();
  });

  it('renders no level toggle for a specialist with a single level', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    const header = await screen.findByRole('toolbar', { name: 'specialist actions' });
    expect(within(header).queryByRole('radio')).toBeNull();
    expect(within(header).queryByRole('radiogroup')).toBeNull();
    const heading = within(header).getByRole('heading', { name: 'coder' });
    const save = within(header).getByRole('button', { name: 'Save' });
    expect(heading.parentElement?.contains(save)).toBe(false);
    expect(save.parentElement?.previousElementSibling).toBe(header.querySelector('code'));
  });
});

describe('form width', () => {
  it('has no centred width limit on the root of the form', async () => {
    render(<Page api={fakeApi()} start="coder" />);
    const root = await screen.findByRole('region', { name: 'specialist coder' });
    expect(root.className).not.toMatch(/max-w-|mx-auto/);
  });
});

describe('specialist filters', () => {
  const fleet = () =>
    configView({
      specialists: [
        specialistEntry(
          'coder',
          {},
          { runtime: 'claude', model: 'opus', allow_commands: ['npm test*'] },
        ),
        specialistEntry(
          'plan',
          { level: 'global', file: '/xdg/aip/specialists/plan.yaml', revision: null },
          { runtime: 'opencode', model: 'x/y', allow_commands: ['npm test*'] },
        ),
        specialistEntry(
          'qa',
          { level: 'project_over_global' },
          { runtime: 'claude', tools: ['Bash'] },
        ),
      ],
    });
  const rows = () =>
    within(screen.getByRole('list', { name: 'specialists', hidden: true }))
      .getAllByRole('listitem', { hidden: true })
      .map((row) => row.textContent ?? '');
  const openPanel = async () => {
    await screen.findByRole('complementary', { name: 'Filters' });
  };
  const pick = async (label: string, name: string) => {
    await openPanel();
    fireEvent.click(await screen.findByRole('combobox', { name: label }));
    fireEvent.click(await screen.findByRole('option', { name }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  };
  const api = () => fakeApi({ config: vi.fn(async () => fleet()) });

  beforeEach(() => window.localStorage.clear());

  it('searches by name and by slug without case', async () => {
    render(<Page api={api()} />);
    const search = await screen.findByRole('searchbox', { name: 'Search specialists' });
    fireEvent.change(search, { target: { value: ' CODER ' } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'pla' } });
    expect(rows()[0]).toContain('plan');
  });

  it('filters by level; an override fits both', async () => {
    render(<Page api={api()} />);
    await screen.findByRole('searchbox', { name: 'Search specialists' });
    fireEvent.click(screen.getByRole('radio', { name: 'Project only' }));
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Shared only' }));
    expect(rows()).toHaveLength(2);
    expect(rows().some((row) => row.includes('coder'))).toBe(false);
  });

  it('combines filters with AND and shows the count on the button', async () => {
    render(<Page api={api()} />);
    await pick('Runtimes', 'claude');
    await waitFor(() => expect(rows()).toHaveLength(2));
    await pick('Commands', 'npm test*');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toContain('coder');
    expect(window.localStorage.getItem('aip.web.specialistFilters')).toContain('npm test*');
  });

  it('shows the filters in a column without a button in a wide window', async () => {
    render(<Page api={api()} />);
    const column = await screen.findByRole('complementary', { name: 'Filters' });
    expect(within(column).getByRole('searchbox', { name: 'Search specialists' })).toBeTruthy();
    expect(within(column).getByRole('radio', { name: 'Project only' })).toBeTruthy();
    expect(within(column).getByRole('combobox', { name: 'Runtimes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
  });

  describe.each([
    ['popover', 1100],
    ['sheet', 600],
  ])('behind a button (%s)', (_name, width) => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches:
          (/min-width: (\d+)px/.test(query) ? Number(/(\d+)px/.exec(query)![1]) : 0) <= width,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = original;
    });

    it('opens the filters from the button and narrows the list', async () => {
      render(<Page api={api()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
      expect(screen.queryByRole('complementary', { name: 'Filters' })).toBeNull();
      fireEvent.change(await screen.findByRole('searchbox', { name: 'Search specialists' }), {
        target: { value: 'cod' },
      });
      expect(rows()).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Filters (1)', hidden: true })).toBeTruthy();
    });

    it('counts the saved filters on the button', async () => {
      window.localStorage.setItem(
        'aip.web.specialistFilters',
        JSON.stringify({ '/repo': { level: 'project', runtimes: ['claude'], models: ['opus'] } }),
      );
      render(<Page api={api()} />);
      expect(await screen.findByRole('button', { name: 'Filters (3)' })).toBeTruthy();
    });

    it('chooses a value inside the panel and narrows the list', async () => {
      render(<Page api={api()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
      fireEvent.click(await screen.findByRole('combobox', { name: 'Runtimes' }));
      fireEvent.click(await screen.findByRole('option', { name: 'opencode' }));
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(rows()[0]).toContain('plan');
    });
  });

  it('shows field values without a group heading', async () => {
    render(<Page api={api()} />);
    await openPanel();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Runtimes' }));
    expect(await screen.findByRole('option', { name: 'claude' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'opencode' })).toBeTruthy();
    expect(screen.queryByText('Project')).toBeNull();
  });

  it('ignores a malformed saved choice', async () => {
    window.localStorage.setItem(
      'aip.web.specialistFilters',
      JSON.stringify({ '/repo': { runtimes: 'x', level: 'bogus' } }),
    );
    render(<Page api={api()} />);
    await screen.findByRole('searchbox', { name: 'Search specialists' });
    expect(rows().length).toBeGreaterThan(0);
  });

  it('hides a list nobody has values for', async () => {
    render(<Page api={api()} />);
    await openPanel();
    expect(screen.getByRole('combobox', { name: 'Tools' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Skills' })).toBeNull();
  });

  it('remembers the filters but not the search, and resets everything', async () => {
    const shared = api();
    const view = render(<Page api={shared} />);
    await pick('Models', 'opus');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search specialists' }), {
      target: { value: 'zzz' },
    });
    expect(rows).toThrow();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(rows()).toHaveLength(3);
    expect(
      (screen.getByRole('searchbox', { name: 'Search specialists' }) as HTMLInputElement).value,
    ).toBe('');
    await pick('Models', 'opus');
    view.unmount();
    render(<Page api={shared} />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(
      (screen.getByRole('searchbox', { name: 'Search specialists' }) as HTMLInputElement).value,
    ).toBe('');
  });

  it('keeps the open form when the filter hides it', async () => {
    window.localStorage.setItem(
      'aip.web.specialistFilters',
      JSON.stringify({ '/repo': { runtimes: ['opencode'] } }),
    );
    render(<Page api={api()} start="coder" />);
    await screen.findByRole('region', { name: 'specialist coder' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('plan');
  });
});

describe('specialist tags', () => {
  const tagged = () =>
    configView({
      specialists: [
        specialistEntry('coder', { shared_tags: ['backend'], own_tags: ['legacy'] }),
        specialistEntry('plan', { own_tags: ['fast'] }),
        specialistEntry('qa'),
      ],
    });
  const listRows = () =>
    within(screen.getByRole('list', { name: 'specialists', hidden: true }))
      .getAllByRole('listitem', { hidden: true })
      .map((row) => row.textContent ?? '');
  const openPanel = async () => {
    await screen.findByRole('complementary', { name: 'Filters' });
  };
  const pick = async (name: string, label = 'Tags') => {
    await openPanel();
    fireEvent.click(await screen.findByRole('combobox', { name: label }));
    fireEvent.click(await screen.findByRole('option', { name }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  };

  beforeEach(() => window.localStorage.clear());

  it('shows the shared tag with a mark and the own tag without one', async () => {
    render(<Page api={fakeApi({ config: vi.fn(async () => tagged()) })} />);
    const chips = await screen.findByTestId('tags-coder');
    const shared = within(chips).getByText('backend').closest('[data-shared]');
    expect(shared?.getAttribute('title')).toContain('Shared tag');
    expect(within(chips).getByText('Shared:')).toBeTruthy();
    expect(within(chips).getByText('legacy').closest('[data-shared]')).toBeNull();
    expect(screen.queryByTestId('tags-qa')).toBeNull();
  });

  it('keeps specialists that have any of the chosen tags and remembers the choice', async () => {
    const api = fakeApi({ config: vi.fn(async () => tagged()) });
    const view = render(<Page api={api} />);
    await screen.findByTestId('tags-coder');
    expect(listRows()).toHaveLength(3);
    await pick('backend');
    await pick('fast');
    await waitFor(() => expect(listRows()).toHaveLength(2));
    expect(listRows().some((row) => row.includes('QA'))).toBe(false);
    expect(window.localStorage.getItem('aip.web.specialistTags')).toBe(
      JSON.stringify({ '/repo': ['backend', 'fast'] }),
    );
    view.unmount();
    render(<Page api={api} />);
    await screen.findByTestId('tags-plan');
    expect(listRows()).toHaveLength(2);
  });

  it('drops a chosen tag that nobody has any more', async () => {
    window.localStorage.setItem(
      'aip.web.specialistTags',
      JSON.stringify({ '/repo': ['gone', 'fast'] }),
    );
    render(<Page api={fakeApi({ config: vi.fn(async () => tagged()) })} />);
    await screen.findByTestId('tags-plan');
    expect(listRows()).toHaveLength(1);
    await waitFor(() =>
      expect(window.localStorage.getItem('aip.web.specialistTags')).toBe(
        JSON.stringify({ '/repo': ['fast'] }),
      ),
    );
  });

  it('keeps the open form when the filter hides it and offers to reset the filter', async () => {
    window.localStorage.setItem('aip.web.specialistTags', JSON.stringify({ '/repo': ['fast'] }));
    render(<Page api={fakeApi({ config: vi.fn(async () => tagged()) })} start="qa" />);
    await screen.findByTestId('tags-plan');
    expect(screen.getByRole('region', { name: 'specialist qa' })).toBeTruthy();
    expect(listRows().some((row) => row.includes('QA'))).toBe(false);
  });

  it('shows an empty result with a reset button', async () => {
    window.localStorage.setItem('aip.web.specialistTags', JSON.stringify({ '/repo': ['legacy'] }));
    const view = configView({
      specialists: [specialistEntry('coder', { own_tags: ['legacy'] })],
    });
    render(<Page api={fakeApi({ config: vi.fn(async () => view) })} />);
    await screen.findByTestId('tags-coder');
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove legacy' }));
    // nothing chosen: every specialist is back
    expect(listRows()).toHaveLength(1);
  });

  it('shows shared tags in the form read only with a link to the settings', async () => {
    const view = configView({
      specialists: [
        specialistEntry('coder', {
          raw: { name: 'Кодировщик', tags: ['legacy'] },
          shared_tags: ['backend'],
          own_tags: ['legacy'],
        }),
      ],
    });
    render(<Page api={fakeApi({ config: vi.fn(async () => view) })} start="coder" />);
    const field = await screen.findByTestId('specialist-tags');
    const shared = within(field).getByRole('list', { name: 'shared tags' });
    expect(within(shared).getByText('backend')).toBeTruthy();
    expect(within(shared).queryByRole('button')).toBeNull();
    expect(within(field).queryByRole('link', { name: 'Manage shared tags' })).toBeNull();
    expect(within(field).getByRole('button', { name: 'Remove legacy' })).toBeTruthy();
  });

  it('writes own tags to the project file', async () => {
    const writeSpecialist = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'n',
      file: '/f',
    }));
    const view = configView({
      specialists: [
        specialistEntry('coder', {
          raw: { name: 'Кодировщик', tags: ['legacy'] },
          shared_tags: ['backend'],
          own_tags: ['legacy'],
        }),
      ],
    });
    render(
      <Page api={fakeApi({ writeSpecialist, config: vi.fn(async () => view) })} start="coder" />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove legacy' }));
    fireEvent.click(within(screen.getByTestId('specialist-tags')).getByRole('combobox'));
    fireEvent.change(await screen.findByRole('combobox', { name: /Search in Tags/ }), {
      target: { value: 'slow' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /slow/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist.mock.calls[0]).toEqual([
      'coder',
      { name: 'Кодировщик', tags: ['slow'] },
      'rev-coder',
      'project',
    ]);
  });

  it('shows the tags of a shared file and cannot edit them', async () => {
    const writeSpecialist = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'n',
      file: '/f',
    }));
    const view = configView({
      specialists: [
        specialistEntry('qa', {
          level: 'global',
          file: '/xdg/aip/specialists/qa.yaml',
          revision: null,
          raw: { name: 'QA', tags: ['review'] },
          shared_tags: ['review'],
        }),
      ],
    });
    render(<Page api={fakeApi({ writeSpecialist, config: vi.fn(async () => view) })} start="qa" />);
    const field = await screen.findByTestId('specialist-tags');
    expect(within(field).getByText('review')).toBeTruthy();
    expect(within(field).queryByRole('combobox')).toBeNull();
    expect((screen.getByLabelText('Model') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(writeSpecialist).not.toHaveBeenCalled();
  });

  it('copies a shared specialist to the project without its tags', async () => {
    const writeSpecialist = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'n',
      file: '/f',
    }));
    const view = configView({
      specialists: [
        specialistEntry('qa', {
          level: 'global',
          file: '/xdg/aip/specialists/qa.yaml',
          revision: null,
          raw: { name: 'QA', model: 'sonnet', tags: ['review'] },
          shared_tags: ['review'],
        }),
      ],
    });
    render(<Page api={fakeApi({ writeSpecialist, config: vi.fn(async () => view) })} start="qa" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Override in the project' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist.mock.calls[0]).toEqual([
      'qa',
      { name: 'QA', model: 'sonnet' },
      null,
      'project',
    ]);
  });
});
