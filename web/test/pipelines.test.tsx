// @vitest-environment jsdom
import { act, choose, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';
import {
  PREVIEW_DELAY_MS,
  draftOf,
  valueOf,
} from '../src/features/pipelines/form/PipelineForm.tsx';
import PipelinesPage from '../src/features/pipelines/PipelinesPage.tsx';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';
import type { EditorPipeline, FieldError } from '../src/shared/api/types.ts';

import {
  actionEntry,
  configView,
  fakeApi,
  openFake,
  runView,
  specialistEntry,
  pipelineOf,
  sourcesFor,
  systemStagesView,
} from './fixtures.ts';

vi.mock('@xyflow/react', async () => (await import('./fakeFlow.tsx')).fakeFlow());

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const RAW = {
  steps: [
    { id: 'plan', specialist: 'plan' },
    { id: 'code', specialist: 'coder', on_reject: { goto: 'plan', max_rounds: 2 } },
    { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 3 } },
  ],
};

function entry(id: string, overrides: Partial<EditorPipeline> = {}): EditorPipeline {
  const base = {
    id,
    level: 'project' as const,
    file: `/repo/aip/pipelines/${id}.yaml`,
    revision: `rev-${id}`,
    raw: RAW,
    shared_tags: [] as string[],
    own_tags: [] as string[],
    ...overrides,
  };
  return { ...base, sources: overrides.sources ?? sourcesFor('pipelines', base) };
}

const specialists = ['plan', 'coder', 'reviewer', 'writer'].map((slug) => specialistEntry(slug));

function api(overrides: Partial<Api> = {}, pipelines = [entry('feature')]): Api {
  return fakeApi({
    config: vi.fn(async () => configView({ specialists, pipelines })),
    ...overrides,
  });
}

function Page({
  api,
  start = null,
  runs = [],
}: {
  api: Api;
  start?: string | null;
  runs?: ReturnType<typeof runView>[];
}) {
  const [selected, setSelected] = useState<string | null>(start);
  return <PipelinesPage api={api} runs={runs} selected={selected} onSelect={setSelected} />;
}

const stepBox = async (index: number) =>
  (await screen.findAllByRole('listitem', { name: /^step \d+$/ }))[index]!;

// Fake timers stop `findBy*` from polling, so the preview tests read the DOM directly.
const openPreview = () =>
  fireEvent.mouseDown(screen.getByRole('tab', { name: /Diagram/ }), { button: 0 });
const openForm = () =>
  fireEvent.mouseDown(screen.getByRole('tab', { name: /Form/ }), { button: 0 });

const stepNow = (index: number) => screen.getAllByRole('listitem', { name: /^step \d+$/ })[index]!;

describe('the name of a pipeline', () => {
  it('shows the name in the list and in the heading, with the id in the tooltip', async () => {
    const named = entry('feature', { raw: { ...RAW, name: 'Новая функция' } });
    render(<Page api={api({}, [named])} start="feature" />);
    const list = await screen.findByRole('list', { name: 'pipeline' });
    const item = within(list).getByRole('button', { name: /Новая функция/ });
    expect(item.getAttribute('title')).toBe('feature');
    expect(await screen.findByRole('heading', { name: 'Новая функция' })).toBeTruthy();
  });

  it('writes the typed name first and drops a cleared one', () => {
    const draft = draftOf({ ...RAW, name: 'Старое' });
    expect(draft.name).toBe('Старое');
    expect(Object.keys(valueOf({ ...draft, name: '  Новое ' }))).toEqual(['name', 'steps']);
    expect(valueOf({ ...draft, name: '  Новое ' }).name).toBe('Новое');
    expect('name' in valueOf({ ...draft, name: '  ' })).toBe(false);
  });

  it('saves a new pipeline with the name from the field', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writePipeline })} start="new" />);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Мой пайплайн' } });
    fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    const added = await stepBox(0);
    choose(within(added).getByRole('combobox', { name: 'step specialist' }), /\(writer\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    const [id, value] = writePipeline.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(id).toBe('mine');
    expect(Object.keys(value)[0]).toBe('name');
    expect(value.name).toBe('Мой пайплайн');
  });

  it('shows the error of an empty name at the field', async () => {
    const named = entry('feature', { raw: { ...RAW, name: 'x' } });
    const previewPipeline = vi.fn(async () => ({
      topology: null,
      errors: [{ path: 'swarm.pipelines.feature.name', message: 'must not be empty' }],
    }));
    render(<Page api={api({ previewPipeline }, [named])} start="feature" />);
    const field = await screen.findByLabelText('Name');
    fireEvent.change(field, { target: { value: ' ' } });
    expect(await screen.findByText('must not be empty')).toBeTruthy();
  });
});

describe('routes and the tab', () => {
  it('still reads the old addresses', () => {
    expect(parseRoute('#workflows/feature')).toEqual({
      view: 'pipelines',
      run: 'feature',
      group: null,
      step: null,
      tab: null,
    });
    expect(parseRoute('#workflows').view).toBe('pipelines');
  });

  it('replaces an old address with the new one', async () => {
    window.location.hash = '#workflows/feature';
    render(<App api={api()} openStream={openFake} />);
    expect(await screen.findByRole('heading', { name: 'feature' })).toBeTruthy();
    expect(window.location.hash).toBe('#pipelines/feature');
  });

  it('reads and writes the pipelines addresses', () => {
    expect(parseRoute('#pipelines/feature')).toEqual({
      view: 'pipelines',
      run: 'feature',
      group: null,
      step: null,
      tab: null,
    });
    expect(parseRoute('#pipelines').run).toBeNull();
    expect(formatRoute({ view: 'pipelines', run: 'new', group: null, step: null, tab: null })).toBe(
      '#pipelines/new',
    );
  });

  it('shows the file of a pipeline as a chip under the heading, none for a new one', async () => {
    window.location.hash = '#pipelines/feature';
    render(<App api={api()} openStream={openFake} />);
    const heading = await screen.findByRole('heading', { name: 'feature' });
    const section = heading.closest('section')!;
    const chip = section.querySelector('code')!;
    expect(chip.getAttribute('title')).toBe(chip.textContent);
    expect(chip.textContent).toMatch(/\.yaml$/);
    expect(chip.className).toContain('bg-muted');
    expect(heading.contains(chip)).toBe(false);
    expect(heading.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    window.location.hash = '#pipelines/new';
    render(<App api={api()} openStream={openFake} />);
    const created = await screen.findByRole('heading', { name: 'New pipeline' });
    expect(created.closest('section')!.querySelector('code')).toBeNull();
  });

  it('opens the form of the pipeline from the address', async () => {
    window.location.hash = '#pipelines/feature';
    render(<App api={api()} openStream={openFake} />);
    expect(screen.getByRole('link', { name: 'Pipeline' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await screen.findByRole('heading', { name: 'feature' })).toBeTruthy();
    expect(window.location.hash).toBe('#pipelines/feature');
  });
});

describe('the list', () => {
  it('shows the levels and the errors, and overrides a global pipeline', async () => {
    let level: 'global' | 'project_over_global' = 'global';
    const quick = () =>
      entry('quick', {
        level,
        revision: level === 'global' ? null : 'rev-quick',
        raw: { steps: [{ id: 'code', specialist: 'coder' }] },
      });
    const config = vi.fn(async () =>
      configView({
        specialists,
        pipelines: [entry('feature'), quick()],
        errors: [{ file: '/repo/aip/settings.yaml', path: 'swarm.max', message: 'bad' }],
      }),
    );
    const writePipeline = vi.fn(async () => {
      level = 'project_over_global';
      return { ok: true as const, revision: 'rev-quick', file: '/f' };
    });
    render(<Page api={fakeApi({ config, writePipeline })} start="quick" />);
    const list = await screen.findByRole('list', { name: 'pipeline' });
    await waitFor(() => expect(within(list).getByText('global')).toBeTruthy());
    expect(within(list).getByText('project')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'configuration errors' })).toBeTruthy();
    expect(
      (screen.getAllByLabelText('additional step prompt')[0] as HTMLTextAreaElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Override in the project' }));
    await waitFor(() =>
      expect(writePipeline).toHaveBeenCalledWith(
        'quick',
        { steps: [{ id: 'code', specialist: 'coder' }] },
        null,
        'project',
      ),
    );
    await waitFor(() => expect(within(list).getByText('project over global')).toBeTruthy());
    expect(
      (screen.getAllByLabelText('additional step prompt')[0] as HTMLTextAreaElement).disabled,
    ).toBe(false);
    expect(screen.getByRole('button', { name: 'Remove the override' })).toBeTruthy();
  });
});

describe('steps', () => {
  it('offers only earlier steps for the return', async () => {
    render(<Page api={api()} start="feature" />);
    const options = async (index: number) => {
      const trigger = within(await stepBox(index)).getByRole('combobox', {
        name: 'return to step',
      });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      return names;
    };
    expect(await options(0)).toEqual(['none']);
    expect(await options(1)).toEqual(['none', 'plan']);
    expect(await options(2)).toEqual(['none', 'plan', 'code']);
  });

  it('renames a step by changing its specialist and updates the steps that return to it', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writePipeline })} start="feature" />);
    const plan = await stepBox(0);
    choose(within(plan).getByRole('combobox', { name: 'step specialist' }), /\(writer\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    const [, value, revision] = writePipeline.mock.calls[0] as unknown as [
      string,
      { steps: { id: string; on_reject?: { goto: string } }[] },
      string,
    ];
    expect(value.steps.map((step) => step.id)).toEqual(['writer', 'code', 'review']);
    expect(value.steps[1]?.on_reject?.goto).toBe('writer');
    expect(revision).toBe('rev-feature');
  });

  it('adds, moves and removes steps, keeping the focus on the step', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writePipeline })} start="feature" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add step' }));
    const added = await stepBox(3);
    choose(within(added).getByRole('combobox', { name: 'step specialist' }), /\(writer\)/);
    fireEvent.click(within(added).getByRole('button', { name: 'up' }));
    fireEvent.click(within(await stepBox(0)).getByRole('button', { name: 'delete step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    const value = (
      writePipeline.mock.calls[0] as unknown as [string, ReturnType<typeof valueOf>]
    )[1];
    expect(value).toEqual({
      steps: [
        { id: 'code', specialist: 'coder' },
        { id: 'writer', specialist: 'writer' },
        { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 3 } },
      ],
    });
  });

  it('keeps a return that points below after a move and shows the error of the check', async () => {
    const previewPipeline = vi.fn(async (_id: string, value: Record<string, unknown>) => {
      const steps = value.steps as { id: string }[];
      return steps[1]?.id === 'review'
        ? {
            topology: null,
            errors: [
              {
                path: 'swarm.pipelines.feature.steps[1].on_reject.goto',
                message: 'must name an earlier step',
              },
            ],
          }
        : { topology: pipelineOf(), errors: [] };
    });
    vi.useFakeTimers();
    render(<Page api={api({ previewPipeline })} start="feature" />);
    await act(async () => {});
    fireEvent.click(within(stepNow(2)).getByRole('button', { name: 'up' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    const review = stepNow(1);
    expect(within(review).getByRole('alert').textContent).toContain('must name an earlier step');
    expect(within(review).getByRole('combobox', { name: 'return to step' }).textContent).toBe(
      'code',
    );
  });
});

describe('group steps of the split', () => {
  const epicRaw = { split: { specialist: 'plan' }, steps: [{ id: 'plan', specialist: 'plan' }] };
  const targetRaw = { split: { specialist: 'plan', pipeline: 'explore' } };
  const epicApi = (overrides: Partial<Api> = {}, epic: Record<string, unknown> = epicRaw) =>
    api(overrides, [
      entry('epic', { raw: epic }),
      entry('explore', { raw: RAW }),
      entry('other', { raw: targetRaw }),
    ]);
  const picker = () => screen.findByRole('combobox', { name: 'group steps' });
  const saved = () => vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));

  it('hides the steps and links to the target, writing split.pipeline without steps', async () => {
    const writePipeline = saved();
    render(<Page api={epicApi({ writePipeline })} start="epic" />);
    choose(await picker(), 'explore');
    expect(screen.queryByRole('list', { name: 'steps' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add step' })).toBeNull();
    expect(screen.getByRole('link', { name: 'explore' }).getAttribute('href')).toBe(
      '#pipelines/explore',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    const [, value] = writePipeline.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(value).toEqual({ split: { specialist: 'plan', pipeline: 'explore' } });
  });

  it('keeps the own steps when switching back', async () => {
    render(<Page api={epicApi()} start="epic" />);
    choose(await picker(), 'explore');
    choose(await picker(), 'Own steps');
    expect(
      within(screen.getByRole('list', { name: 'steps' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Add step' })).toBeTruthy();
  });

  it('does not offer a pipeline with its own split.pipeline or the pipeline itself', async () => {
    render(<Page api={epicApi()} start="epic" />);
    fireEvent.keyDown(await picker(), { key: 'Enter' });
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Own steps',
      'explore',
    ]);
  });

  it('saves a pipeline with a target unchanged', async () => {
    const writePipeline = saved();
    render(<Page api={epicApi({ writePipeline }, targetRaw)} start="epic" />);
    expect((await picker()).textContent).toBe('explore');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    const [, value] = writePipeline.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(value).toEqual({ split: { specialist: 'plan', pipeline: 'explore' } });
  });

  const failing = (path: string) =>
    vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [{ path, message: 'bad group steps' }],
    }));

  it.each([
    ['swarm.pipelines.epic.split.pipeline', targetRaw],
    ['swarm.pipelines.epic.steps', epicRaw],
  ])('shows the error of %s at the choice, not in the general block', async (path, raw) => {
    render(<Page api={epicApi({ writePipeline: failing(path) }, raw)} start="epic" />);
    await picker();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const split = await screen.findByRole('group', { name: 'Task split' });
    await waitFor(() =>
      expect(within(split).getByRole('alert').textContent).toContain('bad group'),
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('drops the target when the split is switched off', () => {
    const draft = draftOf(targetRaw);
    expect(valueOf({ ...draft, split: null })).toEqual({ steps: [] });
  });
});

describe('human review', () => {
  const raw = {
    steps: [
      { id: 'code', specialist: 'coder', human_review: true },
      { id: 'review', specialist: 'reviewer' },
    ],
  };

  it('reads human_review into the draft and writes it only when on', () => {
    const draft = draftOf(raw);
    expect(draft.steps.map((step) => step.humanReview)).toEqual([true, false]);
    const value = valueOf(draft) as { steps: Record<string, unknown>[] };
    expect(value.steps[0]?.human_review).toBe(true);
    expect('human_review' in (value.steps[1] ?? {})).toBe(false);
    draft.steps[0]!.humanReview = false;
    const off = valueOf(draft) as { steps: Record<string, unknown>[] };
    expect('human_review' in (off.steps[0] ?? {})).toBe(false);
  });
});

describe('preview', () => {
  it('asks once for a series of edits, after the delay', async () => {
    vi.useFakeTimers();
    const previewPipeline = vi.fn(async () => ({ topology: pipelineOf(), errors: [] }));
    render(<Page api={api({ previewPipeline })} start="feature" />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(previewPipeline).toHaveBeenCalledTimes(1);
    const input = stepNow(0).querySelector('textarea[aria-label="additional step prompt"]')!;
    for (const text of ['p', 'pl', 'pla', 'plan2']) {
      fireEvent.change(input, { target: { value: text } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    expect(previewPipeline).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(previewPipeline).toHaveBeenCalledTimes(2);
    const last = previewPipeline.mock.calls[1] as unknown as [
      string,
      { steps: { additional_prompt: string }[] },
    ];
    expect(last[0]).toBe('feature');
    expect(last[1].steps[0]?.additional_prompt).toBe('plan2');
    openPreview();
    expect(screen.getByTestId('pipeline-canvas')).toBeTruthy();
    expect(document.querySelectorAll('[data-kind="step"]')).toHaveLength(3);
  });

  it('marks the diagram as outdated while the draft is invalid', async () => {
    vi.useFakeTimers();
    const previewPipeline = vi
      .fn()
      .mockResolvedValueOnce({ topology: pipelineOf(), errors: [] })
      .mockResolvedValue({
        topology: null,
        errors: [
          {
            path: 'swarm.pipelines.feature.steps[0].specialist',
            message: 'unknown specialist `reviewr`',
          },
        ],
      });
    render(<Page api={api({ previewPipeline })} start="feature" />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(screen.queryByText('stale')).toBeNull();
    choose(within(stepNow(0)).getByRole('combobox', { name: 'step specialist' }), /\(writer\)/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(screen.getByText('stale')).toBeTruthy();
    expect(within(stepNow(0)).getByRole('alert').textContent).toContain('unknown specialist');
    openPreview();
    expect(screen.getByTestId('pipeline-canvas')).toBeTruthy();
    expect(document.querySelector('[data-kind="step"]')?.getAttribute('data-error')).toBe('true');
    expect(screen.getAllByText('stale')).toHaveLength(2);
    expect(screen.getByText(/errors on the nodes/)).toBeTruthy();
    expect(screen.queryAllByRole('listitem', { name: /^step \d+$/ })).toHaveLength(0);
  });

  it('drops the answer to an older draft', async () => {
    vi.useFakeTimers();
    type Answer = { topology: ReturnType<typeof pipelineOf>; errors: FieldError[] };
    const resolvers: ((value: Answer) => void)[] = [];
    const previewPipeline = vi.fn(
      () =>
        new Promise<Answer>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    render(<Page api={api({ previewPipeline })} start="feature" />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    fireEvent.change(stepNow(0).querySelector('textarea[aria-label="additional step prompt"]')!, {
      target: { value: 'first' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(resolvers).toHaveLength(2);
    const failed = (message: string): Answer => ({
      topology: pipelineOf(),
      errors: [{ path: 'swarm.pipelines.feature.steps[0].specialist', message }],
    });
    await act(async () => {
      resolvers[1]!(failed('fresh'));
    });
    await act(async () => {
      resolvers[0]!(failed('old'));
    });
    expect(within(stepNow(0)).getByRole('alert').textContent).toContain('fresh');
    openPreview();
    expect(document.querySelector('[data-kind="step"]')?.getAttribute('data-error')).toBe('true');
  });
});

describe('tabs', () => {
  it('shows the form first and the diagram on its tab, keeping the draft', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'n', file: '/f' }));
    const previewPipeline = vi.fn(async () => ({ topology: pipelineOf(), errors: [] }));
    render(<Page api={api({ writePipeline, previewPipeline })} start="feature" />);
    await stepBox(0);
    expect(screen.getByRole('tab', { name: /Form/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('pipeline-canvas')).toBeNull();
    await waitFor(() => expect(previewPipeline).toHaveBeenCalled());
    openPreview();
    expect(screen.getByTestId('pipeline-canvas')).toBeTruthy();
    expect(screen.queryAllByRole('listitem', { name: /^step \d+$/ })).toHaveLength(0);
    openForm();
    expect(screen.queryByTestId('pipeline-canvas')).toBeNull();
    fireEvent.change(screen.getAllByLabelText('additional step prompt')[0]!, {
      target: { value: 'plan2' },
    });
    openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    const written = writePipeline.mock.calls[0] as unknown as [
      string,
      { steps: { additional_prompt: string }[] },
    ];
    expect(written[1].steps[0]?.additional_prompt).toBe('plan2');
  });

  it('marks the diagram tab as outdated and keeps the errors on the form', async () => {
    const previewPipeline = vi.fn(async () => ({
      topology: null,
      errors: [
        { path: 'swarm.pipelines.feature.steps[0].specialist', message: 'unknown specialist `x`' },
      ],
    }));
    render(<Page api={api({ previewPipeline })} start="feature" />);
    await stepBox(0);
    await waitFor(() => expect(previewPipeline).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(screen.getByRole('tab', { name: /Diagram/ })).getByText('stale')).toBeTruthy(),
    );
    expect(within(await stepBox(0)).getByRole('alert').textContent).toContain('unknown specialist');
    openPreview();
    expect(screen.getByText(/errors on the nodes/)).toBeTruthy();
  });
});

describe('saving and deleting', () => {
  it('says that new runs get the change and clears the unsaved state', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writePipeline })} start="feature" />);
    fireEvent.change(
      (await stepBox(0)).querySelector('textarea[aria-label="additional step prompt"]')!,
      {
        target: { value: 'analysis' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('status')).textContent).toContain('new runs');
  });

  it('shows the errors of a refused save and offers to reread after a conflict', async () => {
    const writePipeline = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: 'invalid',
        errors: [
          {
            path: 'swarm.pipelines.feature.steps[1].on_reject.max_rounds',
            message: 'must be an integer from 1 to 10',
          },
        ],
      })
      .mockResolvedValueOnce({ ok: false, reason: 'conflict', message: 'file changed' });
    const config = vi.fn(async () => configView({ specialists, pipelines: [entry('feature')] }));
    render(<Page api={fakeApi({ config, writePipeline })} start="feature" />);
    fireEvent.change(
      (await stepBox(0)).querySelector('textarea[aria-label="additional step prompt"]')!,
      {
        target: { value: 'analysis' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await within(await stepBox(1)).findByRole('alert')).textContent).toContain(
      'must be an integer from 1 to 10',
    );
    expect(
      (
        (await stepBox(0)).querySelector(
          'textarea[aria-label="additional step prompt"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe('analysis');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reread the pipeline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reread' }));
    await waitFor(() => expect(config).toHaveBeenCalledTimes(2));
  });

  it('names the active runs when deleting a pipeline', async () => {
    const deletePipeline = vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' }));
    render(
      <Page
        api={api({ deletePipeline })}
        start="feature"
        runs={[
          runView({ pipeline: 'feature' }),
          runView({ id: 'done', pipeline: 'feature', finished: true }),
        ]}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Runs in progress: 1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(deletePipeline).toHaveBeenCalledWith('feature', 'rev-feature', 'project'),
    );
    expect((await screen.findAllByText('Pipeline «feature» deleted')).length).toBeGreaterThan(0);
  });

  it('forgets the layout of the diagram of a deleted pipeline and keeps the others', async () => {
    window.localStorage.setItem('aip.web.canvasLayout./repo.feature', '{"plan":{"x":1,"y":2}}');
    window.localStorage.setItem('aip.web.canvasLayout./repo.other', '{"plan":{"x":1,"y":2}}');
    window.localStorage.setItem('aip.web.canvasAnchors./repo.feature', '{"a->b":{"source":"top"}}');
    window.localStorage.setItem('aip.web.canvasAnchors./repo.other', '{"a->b":{"source":"top"}}');
    render(<Page api={api()} start="feature" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await screen.findAllByText('Pipeline «feature» deleted');
    expect(window.localStorage.getItem('aip.web.canvasLayout./repo.feature')).toBeNull();
    expect(window.localStorage.getItem('aip.web.canvasLayout./repo.other')).not.toBeNull();
    expect(window.localStorage.getItem('aip.web.canvasAnchors./repo.feature')).toBeNull();
    expect(window.localStorage.getItem('aip.web.canvasAnchors./repo.other')).not.toBeNull();
  });

  it('saves a copy under a new id and creates a pipeline from an empty form', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writePipeline })} start="feature" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save as…' }));
    fireEvent.change(screen.getByLabelText('New id'), { target: { value: 'feature-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create a copy' }));
    await waitFor(() =>
      expect(writePipeline).toHaveBeenCalledWith('feature-2', expect.anything(), null, 'project'),
    );
    cleanup();
    writePipeline.mockClear();
    render(<Page api={api({ writePipeline })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New pipeline' }));
    fireEvent.change(await screen.findByLabelText('Id'), { target: { value: 'quick' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    choose(
      within(await stepBox(0)).getByRole('combobox', { name: 'step specialist' }),
      /\(coder\)/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writePipeline).toHaveBeenCalledWith(
        'quick',
        { steps: [{ id: 'coder', specialist: 'coder' }] },
        null,
        'project',
      ),
    );
  });
});

describe('draft conversion', () => {
  it('round-trips a pipeline with split and a prompt on a step', () => {
    const raw = {
      split: { specialist: 'plan', max_groups: 5, additional_prompt: 'не больше модуля' },
      steps: [
        { id: 'code', specialist: 'coder' },
        {
          id: 'review',
          specialist: 'reviewer',
          on_reject: { goto: 'code', max_rounds: 3 },
          additional_prompt: 'тесты',
        },
      ],
    };
    expect(valueOf(draftOf(raw))).toEqual(raw);
  });

  it.each([
    [
      'an own id taking the slot of an id that matches the derivation',
      [
        { id: 'review', specialist: 'coder' },
        { id: 'coder-2', specialist: 'coder' },
      ],
    ],
    [
      'ids in reverse order of the derivation',
      [
        { id: 'coder-2', specialist: 'coder' },
        { id: 'coder', specialist: 'coder' },
      ],
    ],
    [
      'a feature-like file',
      [
        { id: 'plan', specialist: 'planner' },
        { id: 'code', specialist: 'coder' },
        { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 3 } },
        { id: 'coder', specialist: 'coder' },
        { id: 'coder-2', specialist: 'coder' },
      ],
    ],
  ])('keeps the step ids of the file unchanged: %s', (_name, steps) => {
    expect(valueOf(draftOf({ steps }))).toEqual({ steps });
  });

  it('keeps a goto to an unknown step as typed, for the check to report', () => {
    const value = valueOf(
      draftOf({ steps: [{ id: 'a', specialist: 'x', on_reject: { goto: 'zzz', max_rounds: 1 } }] }),
    );
    expect(value).toEqual({
      steps: [{ id: 'a', specialist: 'x', on_reject: { goto: 'zzz', max_rounds: 1 } }],
    });
  });
});

describe('leaving with unsaved edits', () => {
  it('asks before leaving the form and stays on «Stay»', async () => {
    const view = configView({
      specialists,
      pipelines: [entry('feature'), entry('quick')],
    });
    render(<Page api={fakeApi({ config: vi.fn(async () => view) })} start="feature" />);
    fireEvent.change(
      (await stepBox(0)).querySelector('textarea[aria-label="additional step prompt"]')!,
      {
        target: { value: 'analysis' },
      },
    );
    const list = screen.getByRole('list', { name: 'pipeline' });
    fireEvent.click(within(list).getByText('quick'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('unsaved changes');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'feature' })).toBeTruthy();
    fireEvent.click(within(list).getByText('quick'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'quick' })).toBeTruthy();
  });
});

describe('global level', () => {
  const globalEntry = () =>
    entry('quick', {
      level: 'global',
      file: '/xdg/aip/pipelines/quick.yaml',
      revision: null,
      raw: { steps: [{ id: 'code', specialist: 'coder' }] },
    });

  it('opens a shared pipeline for viewing only, with a link to the settings', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'n', file: '/f' }));
    const previewPipeline = vi.fn(async () => ({ topology: null, errors: [] }));
    const config = vi.fn(async () => configView({ specialists, pipelines: [globalEntry()] }));
    render(<Page api={fakeApi({ config, writePipeline, previewPipeline })} start="quick" />);
    expect(await screen.findByText(/view only here/)).toBeTruthy();
    expect(
      (screen.getAllByLabelText('additional step prompt')[0] as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    const link = screen.getByRole('link', { name: 'Edit in Settings' });
    expect(link.getAttribute('href')).toBe('#settings/global/pipelines/quick');
    expect(writePipeline).not.toHaveBeenCalled();
  });

  it('makes a project pipeline global', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'n', file: '/f' }));
    render(<Page api={api({ writePipeline })} start="feature" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make global' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalledWith('feature', RAW, null, 'global'));
  });
});

describe('step ids follow the specialist', () => {
  const saved = async (writePipeline: ReturnType<typeof vi.fn>) => {
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    return (writePipeline.mock.calls[0] as unknown as [string, ReturnType<typeof valueOf>])[1];
  };

  it('has no id field in the step card', async () => {
    render(<Page api={api()} start="feature" />);
    await stepBox(0);
    expect(screen.queryByLabelText('step id')).toBeNull();
  });

  it('writes ids from the specialists of a new pipeline, with a suffix for a repeat', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    window.location.hash = '#pipelines/new';
    render(<App api={api({ writePipeline })} openStream={openFake} />);
    fireEvent.change(await screen.findByLabelText('Id'), { target: { value: 'quick' } });
    for (const slug of ['plan', 'coder', 'coder']) {
      fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
      const index = screen.getAllByRole('listitem', { name: /^step \d+$/ }).length - 1;
      choose(
        within(stepNow(index)).getByRole('combobox', { name: 'step specialist' }),
        new RegExp(`\\(${slug}\\)`),
      );
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const value = await saved(writePipeline);
    expect(value).toEqual({
      steps: [
        { id: 'plan', specialist: 'plan' },
        { id: 'coder', specialist: 'coder' },
        { id: 'coder-2', specialist: 'coder' },
      ],
    });
  });

  it('keeps an own id from the file after another field is edited', async () => {
    const writePipeline = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writePipeline })} start="feature" />);
    fireEvent.change(
      (await stepBox(1)).querySelector(`textarea[aria-label="additional step prompt"]`)!,
      { target: { value: 'be careful' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const value = await saved(writePipeline);
    expect((value.steps as { id: string }[]).map((step) => step.id)).toEqual([
      'plan',
      'code',
      'review',
    ]);
  });

  it('shows the id of a new step in the preview after its specialist changes', async () => {
    const previewPipeline = vi.fn(async () => ({ topology: pipelineOf(), errors: [] }));
    const lastPreviewId = () => {
      const last = previewPipeline.mock.calls.at(-1) as unknown as [
        string,
        { steps: { id: string }[] },
      ];
      return last[1].steps[3]?.id;
    };
    // the preview of a draft waits for the end of the edits: a fake clock instead of the real delay
    vi.useFakeTimers();
    render(<Page api={api({ previewPipeline })} start="feature" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    choose(within(stepNow(3)).getByRole('combobox', { name: 'step specialist' }), /\(writer\)/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(lastPreviewId()).toBe('writer');
    choose(within(stepNow(3)).getByRole('combobox', { name: 'step specialist' }), /\(reviewer\)/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(lastPreviewId()).toBe('reviewer');
  });
});

describe('pipeline tags and filters', () => {
  const tagged = () => [
    entry('feature', {
      shared_tags: ['backend'],
      own_tags: ['legacy'],
      raw: { ...RAW, tags: ['legacy'] },
    }),
    entry('epic', {
      own_tags: ['fast'],
      raw: {
        steps: [{ id: 'plan', specialist: 'plan' }],
        split: { specialist: 'writer' },
        tags: ['fast'],
      },
    }),
    entry('quick', {
      level: 'global',
      shared_tags: ['fast'],
      file: '/xdg/aip/pipelines/quick.yaml',
      revision: null,
      raw: { steps: [{ id: 'code', specialist: 'coder' }], tags: ['fast'] },
    }),
  ];
  const configOf = (pipelines = tagged()) =>
    vi.fn(async () => configView({ specialists, pipelines }));
  const rows = () =>
    within(screen.getByRole('list', { name: 'pipeline', hidden: true }))
      .getAllByRole('listitem', { hidden: true })
      .map((row) => row.textContent ?? '');
  const pick = async (name: string, label: string) => {
    const panel = await screen.findByRole('complementary', { name: 'Filters' });
    fireEvent.click(await within(panel).findByRole('combobox', { name: label }));
    fireEvent.click(await screen.findByRole('option', { name }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  };

  beforeEach(() => window.localStorage.clear());

  it('shows the shared tag with a mark and the own tag without one', async () => {
    render(<Page api={fakeApi({ config: configOf() })} />);
    const chips = await screen.findByTestId('tags-feature');
    expect(within(chips).getByText('Shared:')).toBeTruthy();
    expect(within(chips).getByText('backend').closest('[data-shared]')).toBeTruthy();
    expect(within(chips).getByText('legacy').closest('[data-shared]')).toBeNull();
  });

  it('shows the filters as a third column on a wide window', async () => {
    render(<Page api={fakeApi({ config: configOf() })} />);
    await screen.findByTestId('tags-feature');
    expect(screen.getByRole('complementary', { name: 'Filters' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull();
  });

  it('collapses the column of the filters on its own, apart from the runs', async () => {
    render(<Page api={fakeApi({ config: configOf() })} />);
    await screen.findByTestId('tags-feature');
    await pick('fast', 'Tags');
    const column = await screen.findByRole('complementary', { name: 'Filters' });
    expect(within(column).getByRole('button', { name: 'Remove fast' })).toBeTruthy();
    fireEvent.click(within(column).getByRole('button', { name: 'Collapse filters' }));
    const strip = await screen.findByRole('complementary', { name: 'Filters' });
    expect(strip.style.width).toBe('40px');
    expect(within(strip).getByText('1')).toBeTruthy();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(window.localStorage.getItem('aip.web.pipelineFiltersCollapsed')).toBe('true');
    expect(window.localStorage.getItem('aip.web.runFiltersCollapsed')).toBeNull();
    expect(window.localStorage.getItem('aip.web.specialistFiltersCollapsed')).toBeNull();
    fireEvent.click(within(strip).getByRole('button', { name: 'Expand filters' }));
    expect((await screen.findByRole('complementary', { name: 'Filters' })).style.width).toBe(
      '256px',
    );
  });

  it('keeps pipelines with any chosen tag and remembers the choice per repository', async () => {
    const api = fakeApi({ config: configOf() });
    const view = render(<Page api={api} />);
    await screen.findByTestId('tags-feature');
    expect(rows()).toHaveLength(3);
    await pick('fast', 'Tags');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().some((row) => row.includes('feature'))).toBe(false);
    expect(JSON.parse(window.localStorage.getItem('aip.web.pipelineFilters') ?? '{}')).toEqual({
      '/repo': { level: 'all', tags: ['fast'], specialists: [] },
    });
    view.unmount();
    render(<Page api={api} />);
    await screen.findByTestId('tags-epic');
    expect(rows()).toHaveLength(2);
  });

  it('filters by a specialist of the steps or of the split', async () => {
    render(<Page api={fakeApi({ config: configOf() })} />);
    await screen.findByTestId('tags-feature');
    await pick('WRITER', 'Specialists');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toContain('epic');
  });

  it('resets the filters when nothing matches', async () => {
    render(<Page api={fakeApi({ config: configOf() })} />);
    await screen.findByTestId('tags-feature');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pipelines' }), {
      target: { value: 'zzz' },
    });
    expect(await screen.findByText('No pipeline matches the filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('hides the open pipeline from the list when the filter excludes it', async () => {
    render(<Page api={fakeApi({ config: configOf() })} start="feature" />);
    await screen.findByTestId('tags-epic');
    await pick('fast', 'Tags');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'feature' })).toBeTruthy();
  });

  describe('behind a button', () => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: (/min-width: (\d+)px/.test(query) ? Number(/(\d+)px/.exec(query)![1]) : 0) <= 1100,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = original;
    });

    it('opens the filters from the button and counts them', async () => {
      render(<Page api={fakeApi({ config: configOf() })} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
      expect(screen.queryByRole('complementary', { name: 'Filters' })).toBeNull();
      fireEvent.change(await screen.findByRole('searchbox', { name: 'Search pipelines' }), {
        target: { value: 'epi' },
      });
      expect(rows()).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Filters (1)', hidden: true })).toBeTruthy();
    });
  });
});

describe('the tags field of a pipeline', () => {
  const withTags = () =>
    configView({
      specialists,
      pipelines: [
        entry('feature', {
          shared_tags: ['backend'],
          own_tags: ['legacy'],
          raw: { ...RAW, tags: ['legacy'] },
        }),
      ],
    });

  it('writes own tags to the project file and keeps the shared one out of it', async () => {
    const writePipeline = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'n',
      file: '/f',
    }));
    render(
      <Page
        api={fakeApi({ writePipeline, config: vi.fn(async () => withTags()) })}
        start="feature"
      />,
    );
    const field = await screen.findByTestId('pipeline-tags');
    expect(within(field).getByText('backend')).toBeTruthy();
    expect(within(field).queryByRole('button', { name: 'Remove backend' })).toBeNull();
    fireEvent.click(within(field).getByRole('button', { name: 'Remove legacy' }));
    fireEvent.click(within(field).getByRole('combobox'));
    fireEvent.change(await screen.findByRole('combobox', { name: /Search in Tags/ }), {
      target: { value: 'slow' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /slow/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    expect(writePipeline.mock.calls[0]?.[1]).toMatchObject({ tags: ['slow'] });
    expect(writePipeline.mock.calls[0]?.[3]).toBe('project');
  });

  it('writes no tags key for an empty list', () => {
    expect(valueOf({ ...draftOf(RAW), tags: [] })).not.toHaveProperty('tags');
    expect(valueOf({ ...draftOf({ ...RAW, tags: ['a'] }) }).tags).toEqual(['a']);
  });

  it('shows the error of the tags at the field', async () => {
    const previewPipeline = vi.fn(async () => ({
      topology: null,
      errors: [{ path: 'swarm.pipelines.feature.tags', message: 'bad tag' }],
    }));
    render(<Page api={api({ previewPipeline })} start="feature" />);
    const field = await screen.findByTestId('pipeline-tags');
    expect(await within(field).findByText('bad tag')).toBeTruthy();
  });

  it('overrides a shared pipeline with the value of the shared file, tags included', async () => {
    const writePipeline = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'n',
      file: '/f',
    }));
    const quick = entry('quick', {
      level: 'global',
      shared_tags: ['fast'],
      file: '/xdg/aip/pipelines/quick.yaml',
      revision: null,
      raw: { steps: [{ id: 'code', specialist: 'coder' }], tags: ['fast'] },
    });
    render(
      <Page
        api={fakeApi({
          writePipeline,
          config: vi.fn(async () => configView({ specialists, pipelines: [quick] })),
        })}
        start="quick"
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Override in the project' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    expect(writePipeline.mock.calls[0]?.[0]).toBe('quick');
    expect(writePipeline.mock.calls[0]?.[3]).toBe('project');
  });
});

describe('pipeline sections and addresses', () => {
  it('reads and writes the addresses of actions and system stages', () => {
    const route = (run: string | null, group: string | null) => ({
      view: 'pipelines' as const,
      run,
      group,
      step: null,
      tab: null,
    });
    expect(parseRoute('#pipelines/actions/commit')).toEqual(route('commit', 'actions'));
    expect(parseRoute('#pipelines/system/resolve')).toEqual(route('resolve', 'system'));
    expect(parseRoute('#pipelines/actions/new')).toEqual(route('new', 'actions'));
    expect(formatRoute(route('commit', 'actions'))).toBe('#pipelines/actions/commit');
    expect(formatRoute(route('delivery', 'system'))).toBe('#pipelines/system/delivery');
    expect(formatRoute(route('feature', null))).toBe('#pipelines/feature');
    expect(formatRoute(route(null, 'actions'))).toBe('#pipelines');
  });

  it('ignores a level part of the address of a system stage', () => {
    const route = (run: string, group: string, step: string | null) => ({
      view: 'pipelines' as const,
      run,
      group,
      step,
      tab: null,
    });
    expect(parseRoute('#pipelines/system/resolve/global')).toEqual(
      route('resolve', 'system', null),
    );
    expect(parseRoute('#pipelines/system/resolve/other')).toEqual(route('resolve', 'system', null));
    expect(parseRoute('#pipelines/actions/commit/global')).toEqual(
      route('commit', 'actions', null),
    );
    expect(formatRoute(route('resolve', 'system', 'global'))).toBe('#pipelines/system/resolve');
    expect(formatRoute(route('resolve', 'system', null))).toBe('#pipelines/system/resolve');
    expect(formatRoute(route('commit', 'actions', 'global'))).toBe('#pipelines/actions/commit');
    expect(formatRoute(route('feature', null as unknown as string, 'global'))).toBe(
      '#pipelines/feature',
    );
  });

  it('keeps a one-part address as a pipeline, even when it is named like a section', () => {
    expect(parseRoute('#pipelines/actions')).toEqual({
      view: 'pipelines',
      run: 'actions',
      group: null,
      step: null,
      tab: null,
    });
    expect(parseRoute('#pipelines/system').group).toBeNull();
    expect(parseRoute('#workflows/actions/commit').run).toBe('actions');
    expect(parseRoute('#workflows/actions/commit').group).toBeNull();
  });

  const sectioned = () =>
    api(
      {
        config: vi.fn(async () =>
          configView({
            specialists,
            pipelines: [entry('feature')],
            actions: [
              actionEntry('commit', { name: 'Commit', run: 'git commit -am x' }),
              actionEntry('notify', { specialist: 'writer' }, 'global'),
            ],
          }),
        ),
        systemStages: vi.fn(async () =>
          systemStagesView({
            stages: systemStagesView().stages.map((stage) =>
              stage.kind === 'resolve'
                ? {
                    ...stage,
                    settings: [
                      { path: 'delivery.resolver_prompt', value: 'Be careful', level: 'project' },
                    ],
                  }
                : stage,
            ),
          }),
        ),
      },
      [entry('feature')],
    );

  const open = async (hash: string, stageApi: Api = sectioned()) => {
    window.location.hash = hash;
    render(<App api={stageApi} openStream={openFake} />);
    await screen.findByRole('tablist', { name: 'Pipeline sections' });
  };
  const tabNamed = (name: string) => screen.getByRole('tab', { name });

  it('shows the three tabs and only the list of the open one', async () => {
    await open('#pipelines');
    expect(tabNamed('Pipelines').getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('list', { name: 'pipeline' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Actions' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'System stages' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Actions' })).toBeNull();
  });

  it('lists the actions with their levels on the tab «Actions»', async () => {
    await open('#pipelines/actions/commit');
    expect(tabNamed('Actions').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('list', { name: 'pipeline' })).toBeNull();
    const actions = within(await screen.findByRole('list', { name: 'Actions' }));
    expect(actions.getByRole('button', { name: /Commit/ }).textContent).toContain('project');
    expect(actions.getByRole('button', { name: /notify/ }).textContent).toContain('global');
  });

  it('lists the system stages with their levels on the tab «System stages»', async () => {
    await open('#pipelines/system/resolve');
    expect(tabNamed('System stages').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('list', { name: 'Actions' })).toBeNull();
    const system = within(await screen.findByRole('list', { name: 'System stages' }));
    expect(system.getAllByRole('button')).toHaveLength(4);
    await waitFor(() =>
      expect(
        system.getByRole('button', { name: /Delivery conflict resolution/ }).textContent,
      ).toContain('project'),
    );
    expect(system.getByRole('button', { name: /Commit message/ }).textContent).toContain('global');
    expect(system.getByRole('button', { name: /Task split/ }).textContent).toContain('global');
  });

  it('opens the tab of stages with an empty screen for an unknown stage', async () => {
    await open('#pipelines/system/other');
    expect(tabNamed('System stages').getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('Pick a system stage.')).toBeTruthy();
  });

  it('shows the filters only on the tab «Pipelines»', async () => {
    const filtered = (hash: string) => {
      cleanup();
      return open(hash);
    };
    await open('#pipelines');
    expect(screen.getByRole('complementary', { name: 'Filters' })).toBeTruthy();
    await filtered('#pipelines/actions/commit');
    expect(screen.queryByRole('complementary', { name: 'Filters' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Filters/ })).toBeNull();
    await filtered('#pipelines/system/resolve');
    expect(screen.queryByRole('complementary', { name: 'Filters' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Filters/ })).toBeNull();
  });

  it('opens the first stage, then the pipeline that was open, from the tabs', async () => {
    await open('#pipelines/feature');
    fireEvent.click(tabNamed('System stages'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/system/split'));
    fireEvent.click(tabNamed('Pipelines'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/feature'));
  });

  it('comes back to the last stage and the last action of their tabs', async () => {
    await open('#pipelines/actions/notify');
    fireEvent.click(tabNamed('System stages'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/system/split'));
    fireEvent.click(
      within(await screen.findByRole('list', { name: 'System stages' })).getByRole('button', {
        name: /Commit message/,
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/system/message'));
    fireEvent.click(tabNamed('Actions'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/actions/notify'));
    fireEvent.click(tabNamed('System stages'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/system/message'));
  });

  it('falls back to the first action when the remembered one is deleted', async () => {
    let actions = [
      actionEntry('commit', { name: 'Commit', run: 'git commit -am x' }),
      actionEntry('notify', { specialist: 'writer' }, 'global'),
    ];
    const changing = api({
      config: vi.fn(async () =>
        configView({ specialists, pipelines: [entry('feature')], actions }),
      ),
      systemStages: vi.fn(async () => systemStagesView()),
      deleteAction: vi.fn(async () => {
        actions = [actions[0]!];
        return { ok: true as const, revision: null, file: '/f' };
      }),
    });
    await open('#pipelines/actions/notify', changing);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/actions/commit'));
    expect(tabNamed('Actions').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabNamed('System stages'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/system/split'));
    fireEvent.click(tabNamed('Actions'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/actions/commit'));
  });

  it('opens the form of a new action when the last action is deleted', async () => {
    let actions = [actionEntry('commit', { name: 'Commit', run: 'git commit -am x' })];
    const changing = api({
      config: vi.fn(async () =>
        configView({ specialists, pipelines: [entry('feature')], actions }),
      ),
      systemStages: vi.fn(async () => systemStagesView()),
      deleteAction: vi.fn(async () => {
        actions = [];
        return { ok: true as const, revision: null, file: '/f' };
      }),
    });
    await open('#pipelines/actions/commit', changing);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/actions/new'));
    expect(tabNamed('Actions').getAttribute('aria-selected')).toBe('true');
  });

  it('stays on the action when the copy of the other level remains after a delete', async () => {
    let actions = [
      actionEntry('notify', { specialist: 'writer' }, 'global'),
      actionEntry('commit', { name: 'Commit', run: 'git commit -am x' }, 'project_over_global'),
    ];
    const deleteAction = vi.fn(async () => {
      actions = [
        actions[0]!,
        actionEntry('commit', { name: 'Commit', run: 'git commit -am x' }, 'global'),
      ];
      return { ok: true as const, revision: null, file: '/f' };
    });
    const changing = api({
      config: vi.fn(async () =>
        configView({ specialists, pipelines: [entry('feature')], actions }),
      ),
      systemStages: vi.fn(async () => systemStagesView()),
      deleteAction,
    });
    await open('#pipelines/actions/commit', changing);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteAction).toHaveBeenCalled());
    await screen.findByText('/xdg/aip/actions/commit.yaml');
    expect(window.location.hash).toBe('#pipelines/actions/commit');
    expect(tabNamed('Actions').getAttribute('aria-selected')).toBe('true');
  });

  it('does not move when the open tab is clicked', async () => {
    await open('#pipelines/system/resolve/global');
    expect(
      await screen.findByRole('heading', { name: 'Delivery conflict resolution' }),
    ).toBeTruthy();
    fireEvent.click(tabNamed('System stages'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.location.hash).toBe('#pipelines/system/resolve');
    expect(tabNamed('System stages').getAttribute('href')).toBe('#pipelines/system/resolve');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('stays on the new pipeline when the tab «Pipelines» is clicked there', async () => {
    await open('#pipelines/new');
    fireEvent.click(tabNamed('Pipelines'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.location.hash).toBe('#pipelines/new');
  });

  it('opens the form of a new action on the tab «Actions» without actions', async () => {
    const empty = api({
      config: vi.fn(async () => configView({ specialists, pipelines: [entry('feature')] })),
      systemStages: vi.fn(async () => systemStagesView()),
    });
    await open('#pipelines', empty);
    await screen.findByRole('list', { name: 'pipeline' });
    await waitFor(() => expect(tabNamed('Actions').getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(tabNamed('Actions'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/actions/new'));
  });

  it('does not leave a form with unsaved edits when asked to stay', async () => {
    await open('#pipelines/actions/commit');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(tabNamed('System stages'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(window.location.hash).toBe('#pipelines/actions/commit');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Renamed');
    fireEvent.click(tabNamed('System stages'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/system/split'));
  });

  it('does not open the tab «Actions» before the configuration loads', async () => {
    const slow = api({ config: vi.fn(() => new Promise<never>(() => undefined)) });
    await open('#pipelines', slow);
    expect(tabNamed('Actions').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(tabNamed('Actions'));
    expect(window.location.hash).toBe('#pipelines');
  });

  it('opens an action and a system stage from the address', async () => {
    window.location.hash = '#pipelines/actions/commit';
    render(<App api={sectioned()} openStream={openFake} />);
    expect(await screen.findByRole('heading', { name: 'Commit' })).toBeTruthy();
    cleanup();
    window.location.hash = '#pipelines/system/message';
    render(<App api={sectioned()} openStream={openFake} />);
    expect(await screen.findByRole('heading', { name: 'Commit message' })).toBeTruthy();
    expect(window.location.hash).toBe('#pipelines/system/message');
  });

  it('writes the address of the clicked entry', async () => {
    await open('#pipelines/actions/commit');
    fireEvent.click(await screen.findByRole('button', { name: /notify/ }));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/actions/notify'));
    fireEvent.click(tabNamed('System stages'));
    fireEvent.click(
      within(await screen.findByRole('list', { name: 'System stages' })).getByRole('button', {
        name: /^Delivery(?! conflict)/,
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/system/delivery'));
    fireEvent.click(tabNamed('Pipelines'));
    fireEvent.click(
      within(await screen.findByRole('list', { name: 'pipeline' })).getByRole('button'),
    );
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/feature'));
  });

  it('moves between stages without a level in the address', async () => {
    await open('#pipelines/system/resolve/global');
    fireEvent.click(
      within(await screen.findByRole('list', { name: 'System stages' })).getByRole('button', {
        name: /Commit message/,
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/system/message'));
  });

  it('shows a system stage as view only with values and their sources', async () => {
    await open('#pipelines/system/resolve');
    await screen.findByRole('heading', { name: 'Delivery conflict resolution' });
    expect(screen.queryByRole('tab', { name: 'Shared' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Additional prompt' })).toBeNull();
    const prompt = await screen.findByTestId('stage-value-delivery.resolver_prompt');
    await waitFor(() => expect(prompt.textContent).toContain('Be careful'));
    expect(prompt.textContent).toContain('set in the project');
    expect(screen.getByTestId('stage-value-delivery.resolver_rounds').textContent).toContain(
      'default',
    );
  });

  it('leads the button of a stage to the project or the shared delivery settings', async () => {
    await open('#pipelines/system/resolve');
    const project = await screen.findByRole('link', { name: 'Edit in Settings' });
    await waitFor(() => expect(project.getAttribute('href')).toBe('#settings/project/delivery'));
    cleanup();
    await open('#pipelines/system/message');
    const shared = await screen.findByRole('link', { name: 'Edit in Settings' });
    expect(shared.getAttribute('href')).toBe('#settings/global/delivery');
  });

  it('shows the delivery mode of a stage by its name', async () => {
    const stagesApi = api(
      {
        config: vi.fn(async () => configView({ specialists, pipelines: [entry('feature')] })),
        systemStages: vi.fn(async () =>
          systemStagesView({
            stages: systemStagesView().stages.map((stage) =>
              stage.kind === 'delivery'
                ? {
                    ...stage,
                    settings: [{ path: 'delivery.mode', value: 'branch', level: 'project' }],
                  }
                : stage,
            ),
          }),
        ),
      },
      [entry('feature')],
    );
    await open('#pipelines/system/delivery', stagesApi);
    await waitFor(() =>
      expect(screen.getByTestId('stage-value-delivery.mode').textContent).toContain('Branch'),
    );
    expect(screen.getByTestId('stage-value-delivery.mode').textContent).toContain(
      'set in the project',
    );
  });

  it('has no settings block and no button for the split', async () => {
    await open('#pipelines/system/split');
    expect(await screen.findByText(/has no settings of its own/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit in Settings' })).toBeNull();
  });

  it('keeps the four system stages when the list of them does not load', async () => {
    const failing = api({
      systemStages: vi.fn(async () => {
        throw new Error('no stages');
      }),
    });
    await open('#pipelines/system/split', failing);
    const system = within(await screen.findByRole('list', { name: 'System stages' }));
    expect(system.getAllByRole('button')).toHaveLength(4);
  });
});

describe('actions at the points of a pipeline', () => {
  const commit = actionEntry('commit', { run: 'git commit -am x' });
  const lint = actionEntry('lint', { run: 'npm run lint' });
  const review = actionEntry('review', { specialist: 'reviewer' });
  const stage = (point: string, id: string) => ({
    id: `action:${point}:${id}`,
    kind: 'action' as const,
    section: 'finish' as const,
    name: id,
    performer: { type: 'command' as const, command: 'x' },
    condition: null,
    status: null,
    group: null,
  });
  const withActions = (
    overrides: Partial<Api> = {},
    raw: Record<string, unknown> = RAW,
    stages = [stage('after_delivery', 'commit')],
  ) =>
    api(
      {
        config: vi.fn(async () =>
          configView({
            specialists,
            pipelines: [entry('feature', { raw })],
            actions: [commit, lint, review],
          }),
        ),
        previewPipeline: vi.fn(async () => ({
          topology: pipelineOf({ stages: stages as never }),
          errors: [],
        })),
        ...overrides,
      },
      [entry('feature', { raw })],
    );
  const point = async (name: string) => within(await screen.findByRole('group', { name }));
  const saved = () => vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
  const valueOfCall = (writePipeline: ReturnType<typeof saved>) =>
    (writePipeline.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];

  it('shows the actions of swarm.stages as inherited', async () => {
    render(<Page api={withActions()} start="feature" />);
    const after = await point('After delivery');
    await waitFor(() => expect(after.getByText('commit')).toBeTruthy());
    expect(after.getByText('inherited')).toBeTruthy();
    expect(after.queryByRole('button', { name: 'Back to inherited' })).toBeNull();
  });

  it('does not let a point be edited before the inherited actions are known', async () => {
    const writePipeline = saved();
    const previewPipeline = vi.fn(() => new Promise<never>(() => {}));
    render(<Page api={withActions({ writePipeline, previewPipeline })} start="feature" />);
    const after = await point('After delivery');
    expect(after.getByText('Loading the inherited actions…')).toBeTruthy();
    expect(after.queryByRole('combobox')).toBeNull();
    expect(after.queryByText('none')).toBeNull();
    expect(writePipeline).not.toHaveBeenCalled();
  });

  it('writes an empty list when the inherited action is removed', async () => {
    const writePipeline = saved();
    render(<Page api={withActions({ writePipeline })} start="feature" />);
    const after = await point('After delivery');
    fireEvent.click(await after.findByRole('button', { name: 'remove commit' }));
    expect(after.getByText('No actions: the point is off.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    expect(valueOfCall(writePipeline).stages).toEqual({ after_delivery: [] });
  });

  it('returns a point to the inheritance by dropping its key', async () => {
    const writePipeline = saved();
    render(
      <Page
        api={withActions({ writePipeline }, { ...RAW, stages: { after_delivery: ['lint'] } })}
        start="feature"
      />,
    );
    const after = await point('After delivery');
    expect(after.queryByText('inherited')).toBeNull();
    expect(after.getByText('lint')).toBeTruthy();
    fireEvent.click(after.getByRole('button', { name: 'Back to inherited' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    expect(valueOfCall(writePipeline).stages).toBeUndefined();
  });

  const ids = (scope: ReturnType<typeof within>) =>
    scope.getAllByRole('listitem').map((item: HTMLElement) => item.getAttribute('data-id'));
  const dragRow = (from: HTMLElement, to: HTMLElement, clientY: number, data = '') => {
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => data), effectAllowed: '' };
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer, clientY });
    fireEvent.drop(to, { dataTransfer, clientY });
  };
  const addTwo = async () => {
    const before = await point('Before delivery');
    choose(
      await before.findByRole('combobox', { name: 'add an action: Before delivery' }),
      'commit',
    );
    choose(before.getByRole('combobox', { name: 'add an action: Before delivery' }), 'lint');
    choose(before.getByRole('combobox', { name: 'add an action: Before delivery' }), 'review');
    return before;
  };

  it('adds actions in order and moves them with Alt+ArrowUp', async () => {
    const writePipeline = saved();
    render(<Page api={withActions({ writePipeline })} start="feature" />);
    const before = await point('Before delivery');
    choose(
      await before.findByRole('combobox', { name: 'add an action: Before delivery' }),
      'commit',
    );
    choose(before.getByRole('combobox', { name: 'add an action: Before delivery' }), 'lint');
    expect(before.queryByRole('button', { name: /^move /i })).toBeNull();
    expect(before.getByRole('button', { name: 'remove lint' })).toBeTruthy();
    fireEvent.keyDown(before.getByRole('listitem', { name: '2. lint' }), {
      key: 'ArrowUp',
      altKey: true,
    });
    expect(ids(before)).toEqual(['lint', 'commit']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    expect(valueOfCall(writePipeline).stages).toEqual({ before_delivery: ['lint', 'commit'] });
  });

  it('reorders the actions of a point by dragging', async () => {
    const writePipeline = saved();
    render(<Page api={withActions({ writePipeline })} start="feature" />);
    const before = await addTwo();
    expect(ids(before)).toEqual(['commit', 'lint', 'review']);
    dragRow(
      before.getByRole('listitem', { name: '2. lint' }),
      before.getByRole('listitem', { name: '1. commit' }),
      -1,
    );
    expect(ids(before)).toEqual(['lint', 'commit', 'review']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    expect(valueOfCall(writePipeline).stages).toEqual({
      before_delivery: ['lint', 'commit', 'review'],
    });
  });

  it('does not change the list when a row is dropped on its own place', async () => {
    const writePipeline = saved();
    render(<Page api={withActions({ writePipeline })} start="feature" />);
    const before = await addTwo();
    dragRow(
      before.getByRole('listitem', { name: '2. lint' }),
      before.getByRole('listitem', { name: '2. lint' }),
      1,
    );
    expect(ids(before)).toEqual(['commit', 'lint', 'review']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    expect(valueOfCall(writePipeline).stages).toEqual({
      before_delivery: ['commit', 'lint', 'review'],
    });
  });

  it('ignores Alt+ArrowUp on the first row and Alt+ArrowDown on the last', async () => {
    render(<Page api={withActions()} start="feature" />);
    const before = await addTwo();
    fireEvent.keyDown(before.getByRole('listitem', { name: '1. commit' }), {
      key: 'ArrowUp',
      altKey: true,
    });
    fireEvent.keyDown(before.getByRole('listitem', { name: '3. review' }), {
      key: 'ArrowDown',
      altKey: true,
    });
    expect(ids(before)).toEqual(['commit', 'lint', 'review']);
  });

  it('keeps an inherited point inherited when a move at the edge does nothing', async () => {
    const stages = [stage('after_delivery', 'commit'), stage('after_delivery', 'lint')];
    render(<Page api={withActions({}, RAW, stages)} start="feature" />);
    const after = await point('After delivery');
    await waitFor(() => expect(after.getAllByRole('listitem').length).toBe(2));
    fireEvent.keyDown(after.getByRole('listitem', { name: '1. commit' }), {
      key: 'ArrowUp',
      altKey: true,
    });
    fireEvent.keyDown(after.getByRole('listitem', { name: '2. lint' }), {
      key: 'ArrowDown',
      altKey: true,
    });
    expect(ids(after)).toEqual(['commit', 'lint']);
    expect(after.getByText('inherited')).toBeTruthy();
  });

  it('does not drag or move rows while the form is being saved', async () => {
    const writePipeline = vi.fn(() => new Promise<never>(() => {}));
    render(<Page api={withActions({ writePipeline })} start="feature" />);
    const before = await addTwo();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    const row = before.getByRole('listitem', { name: '2. lint' });
    await waitFor(() => expect(row.getAttribute('draggable')).toBe('false'));
    fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true });
    expect(ids(before)).toEqual(['commit', 'lint', 'review']);
  });

  it('reorders an inherited point and makes it its own', async () => {
    const writePipeline = saved();
    const stages = [stage('after_delivery', 'commit'), stage('after_delivery', 'lint')];
    render(<Page api={withActions({ writePipeline }, RAW, stages)} start="feature" />);
    const after = await point('After delivery');
    await waitFor(() => expect(after.getByText('inherited')).toBeTruthy());
    await waitFor(() => expect(after.getAllByRole('listitem').length).toBe(2));
    dragRow(
      after.getByRole('listitem', { name: '2. lint' }),
      after.getByRole('listitem', { name: '1. commit' }),
      -1,
    );
    expect(ids(after)).toEqual(['lint', 'commit']);
    expect(after.queryByText('inherited')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    expect(valueOfCall(writePipeline).stages).toEqual({ after_delivery: ['lint', 'commit'] });
  });

  it('ignores a row dropped over another point', async () => {
    const stages = [stage('after_delivery', 'commit'), stage('after_delivery', 'lint')];
    render(<Page api={withActions({}, RAW, stages)} start="feature" />);
    const before = await addTwo();
    const after = await point('After delivery');
    await waitFor(() => expect(after.getAllByRole('listitem').length).toBe(2));
    dragRow(
      before.getByRole('listitem', { name: '2. lint' }),
      after.getByRole('listitem', { name: '1. commit' }),
      -1,
      'lint',
    );
    expect(ids(before)).toEqual(['commit', 'lint', 'review']);
    expect(ids(after)).toEqual(['commit', 'lint']);
    expect(after.getByText('inherited')).toBeTruthy();
  });

  it('offers only commands after the delivery', async () => {
    render(<Page api={withActions()} start="feature" />);
    const after = await point('After delivery');
    await waitFor(() => expect(after.getByText('commit')).toBeTruthy());
    fireEvent.keyDown(await after.findByRole('combobox', { name: /add an action/ }), {
      key: 'Enter',
    });
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Add an action',
      'lint',
    ]);
  });

  it('does not offer the points around the split to a pipeline without one', async () => {
    render(<Page api={withActions()} start="feature" />);
    await point('Before delivery');
    expect(screen.queryByRole('group', { name: 'Before the split' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'After the split' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Task split' }));
    expect(await point('Before the split')).toBeTruthy();
    expect(await point('After the split')).toBeTruthy();
  });

  it('keeps the stages with split.pipeline and drops the split points without a split', () => {
    const raw = {
      split: { specialist: 'plan', pipeline: 'explore' },
      stages: { before_split: ['lint'], after_delivery: ['commit'] },
    };
    const draft = draftOf(raw);
    expect(valueOf(draft)).toEqual(raw);
    expect(valueOf({ ...draft, split: null }).stages).toEqual({ after_delivery: ['commit'] });
    expect(valueOf(draftOf({ steps: [] })).stages).toBeUndefined();
    expect(valueOf(draftOf({ steps: [], stages: { after_delivery: [] } })).stages).toEqual({
      after_delivery: [],
    });
  });
});
