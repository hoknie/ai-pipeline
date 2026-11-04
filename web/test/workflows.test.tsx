// @vitest-environment jsdom
import { act, choose, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import type { Api } from '../src/api.ts';
import { PREVIEW_DELAY_MS, draftOf, valueOf } from '../src/components/WorkflowForm.tsx';
import WorkflowsPage from '../src/components/WorkflowsPage.tsx';
import { formatRoute, parseRoute } from '../src/route.ts';
import type { EditorWorkflow } from '../src/types.ts';

import {
  configView,
  fakeApi,
  openFake,
  runView,
  specialistEntry,
  workflowOf,
  sourcesFor,
} from './fixtures.ts';

vi.mock('../src/components/WorkflowGraph.tsx', () => ({
  WorkflowGraph: ({ workflow }: { workflow: { id: string; steps: { id: string }[] } }) => (
    <div data-testid="graph">{workflow.steps.map((step) => step.id).join(',')}</div>
  ),
}));

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

function entry(id: string, overrides: Partial<EditorWorkflow> = {}): EditorWorkflow {
  const base = {
    id,
    level: 'project' as const,
    file: `/repo/aip/workflows/${id}.yaml`,
    revision: `rev-${id}`,
    raw: RAW,
    ...overrides,
  };
  return { ...base, sources: overrides.sources ?? sourcesFor('workflows', base) };
}

const specialists = ['plan', 'coder', 'reviewer', 'writer'].map((slug) => specialistEntry(slug));

function api(overrides: Partial<Api> = {}, workflows = [entry('feature')]): Api {
  return fakeApi({
    config: vi.fn(async () => configView({ specialists, workflows })),
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
  return <WorkflowsPage api={api} runs={runs} selected={selected} onSelect={setSelected} />;
}

const stepBox = async (index: number) =>
  (await screen.findAllByRole('listitem', { name: /^step \d+$/ }))[index]!;

// Fake timers stop `findBy*` from polling, so the preview tests read the DOM directly.
const openPreview = () =>
  fireEvent.mouseDown(screen.getByRole('tab', { name: /Preview/ }), { button: 0 });
const openForm = () =>
  fireEvent.mouseDown(screen.getByRole('tab', { name: /Form/ }), { button: 0 });

const stepNow = (index: number) => screen.getAllByRole('listitem', { name: /^step \d+$/ })[index]!;

describe('routes and the tab', () => {
  it('reads and writes the workflows addresses', () => {
    expect(parseRoute('#workflows/feature')).toEqual({
      view: 'workflows',
      run: 'feature',
      group: null,
      step: null,
    });
    expect(parseRoute('#workflows').run).toBeNull();
    expect(formatRoute({ view: 'workflows', run: 'new', group: null, step: null })).toBe(
      '#workflows/new',
    );
  });

  it('shows the file of a workflow as a chip under the heading, none for a new one', async () => {
    window.location.hash = '#workflows/feature';
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
    window.location.hash = '#workflows/new';
    render(<App api={api()} openStream={openFake} />);
    const created = await screen.findByRole('heading', { name: 'New workflow' });
    expect(created.closest('section')!.querySelector('code')).toBeNull();
  });

  it('opens the form of the workflow from the address', async () => {
    window.location.hash = '#workflows/feature';
    render(<App api={api()} openStream={openFake} />);
    expect(screen.getByRole('link', { name: 'Workflow' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await screen.findByRole('heading', { name: 'feature' })).toBeTruthy();
    expect(window.location.hash).toBe('#workflows/feature');
  });
});

describe('the list', () => {
  it('shows the levels and the errors, and overrides a global workflow', async () => {
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
        workflows: [entry('feature'), quick()],
        errors: [{ file: '/repo/aip/settings.yaml', path: 'swarm.max', message: 'bad' }],
      }),
    );
    const writeWorkflow = vi.fn(async () => {
      level = 'project_over_global';
      return { ok: true as const, revision: 'rev-quick', file: '/f' };
    });
    render(<Page api={fakeApi({ config, writeWorkflow })} start="quick" />);
    const list = await screen.findByRole('list', { name: 'workflow' });
    await waitFor(() => expect(within(list).getByText('global')).toBeTruthy());
    expect(within(list).getByText('project')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'configuration errors' })).toBeTruthy();
    expect(
      (screen.getAllByLabelText('additional step prompt')[0] as HTMLTextAreaElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Override in the project' }));
    await waitFor(() =>
      expect(writeWorkflow).toHaveBeenCalledWith(
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
    const writeWorkflow = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writeWorkflow })} start="feature" />);
    const plan = await stepBox(0);
    choose(within(plan).getByRole('combobox', { name: 'step specialist' }), 'writer');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeWorkflow).toHaveBeenCalled());
    const [, value, revision] = writeWorkflow.mock.calls[0] as unknown as [
      string,
      { steps: { id: string; on_reject?: { goto: string } }[] },
      string,
    ];
    expect(value.steps.map((step) => step.id)).toEqual(['writer', 'code', 'review']);
    expect(value.steps[1]?.on_reject?.goto).toBe('writer');
    expect(revision).toBe('rev-feature');
  });

  it('adds, moves and removes steps, keeping the focus on the step', async () => {
    const writeWorkflow = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writeWorkflow })} start="feature" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add step' }));
    const added = await stepBox(3);
    choose(within(added).getByRole('combobox', { name: 'step specialist' }), 'writer');
    fireEvent.click(within(added).getByRole('button', { name: 'up' }));
    fireEvent.click(within(await stepBox(0)).getByRole('button', { name: 'delete step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeWorkflow).toHaveBeenCalled());
    const value = (
      writeWorkflow.mock.calls[0] as unknown as [string, ReturnType<typeof valueOf>]
    )[1];
    expect(value).toEqual({
      steps: [
        { id: 'code', specialist: 'coder', on_reject: { goto: 'plan', max_rounds: 2 } },
        { id: 'writer', specialist: 'writer' },
        { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 3 } },
      ],
    });
  });

  it('keeps a return that points below after a move and shows the error of the check', async () => {
    const previewWorkflow = vi.fn(async (_id: string, value: Record<string, unknown>) => {
      const steps = value.steps as { id: string }[];
      return steps[1]?.id === 'review'
        ? {
            topology: null,
            errors: [
              {
                path: 'swarm.workflows.feature.steps[1].on_reject.goto',
                message: 'must name an earlier step',
              },
            ],
          }
        : { topology: workflowOf(), errors: [] };
    });
    vi.useFakeTimers();
    render(<Page api={api({ previewWorkflow })} start="feature" />);
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
  const targetRaw = { split: { specialist: 'plan', workflow: 'explore' } };
  const epicApi = (overrides: Partial<Api> = {}, epic: Record<string, unknown> = epicRaw) =>
    api(overrides, [
      entry('epic', { raw: epic }),
      entry('explore', { raw: RAW }),
      entry('other', { raw: targetRaw }),
    ]);
  const picker = () => screen.findByRole('combobox', { name: 'group steps' });
  const saved = () => vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));

  it('hides the steps and links to the target, writing split.workflow without steps', async () => {
    const writeWorkflow = saved();
    render(<Page api={epicApi({ writeWorkflow })} start="epic" />);
    choose(await picker(), 'explore');
    expect(screen.queryByRole('list', { name: 'steps' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add step' })).toBeNull();
    expect(screen.getByRole('link', { name: 'explore' }).getAttribute('href')).toBe(
      '#workflows/explore',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeWorkflow).toHaveBeenCalled());
    const [, value] = writeWorkflow.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(value).toEqual({ split: { specialist: 'plan', workflow: 'explore' } });
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

  it('does not offer a workflow with its own split.workflow or the workflow itself', async () => {
    render(<Page api={epicApi()} start="epic" />);
    fireEvent.keyDown(await picker(), { key: 'Enter' });
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Own steps',
      'explore',
    ]);
  });

  it('saves a workflow with a target unchanged', async () => {
    const writeWorkflow = saved();
    render(<Page api={epicApi({ writeWorkflow }, targetRaw)} start="epic" />);
    expect((await picker()).textContent).toBe('explore');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeWorkflow).toHaveBeenCalled());
    const [, value] = writeWorkflow.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(value).toEqual({ split: { specialist: 'plan', workflow: 'explore' } });
  });

  const failing = (path: string) =>
    vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [{ path, message: 'bad group steps' }],
    }));

  it.each([
    ['swarm.workflows.epic.split.workflow', targetRaw],
    ['swarm.workflows.epic.steps', epicRaw],
  ])('shows the error of %s at the choice, not in the general block', async (path, raw) => {
    render(<Page api={epicApi({ writeWorkflow: failing(path) }, raw)} start="epic" />);
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

describe('preview', () => {
  it('asks once for a series of edits, after the delay', async () => {
    vi.useFakeTimers();
    const previewWorkflow = vi.fn(async () => ({ topology: workflowOf(), errors: [] }));
    render(<Page api={api({ previewWorkflow })} start="feature" />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(previewWorkflow).toHaveBeenCalledTimes(1);
    const input = stepNow(0).querySelector('textarea[aria-label="additional step prompt"]')!;
    for (const text of ['p', 'pl', 'pla', 'plan2']) {
      fireEvent.change(input, { target: { value: text } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    expect(previewWorkflow).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(previewWorkflow).toHaveBeenCalledTimes(2);
    const last = previewWorkflow.mock.calls[1] as unknown as [
      string,
      { steps: { additional_prompt: string }[] },
    ];
    expect(last[0]).toBe('feature');
    expect(last[1].steps[0]?.additional_prompt).toBe('plan2');
    openPreview();
    expect(screen.getByTestId('graph').textContent).toBe('plan,code,review');
  });

  it('keeps the last graph marked as outdated while the draft is invalid', async () => {
    vi.useFakeTimers();
    const previewWorkflow = vi
      .fn()
      .mockResolvedValueOnce({ topology: workflowOf(), errors: [] })
      .mockResolvedValue({
        topology: null,
        errors: [
          {
            path: 'swarm.workflows.feature.steps[0].specialist',
            message: 'unknown specialist `reviewr`',
          },
        ],
      });
    render(<Page api={api({ previewWorkflow })} start="feature" />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(screen.queryByText('stale')).toBeNull();
    choose(within(stepNow(0)).getByRole('combobox', { name: 'step specialist' }), 'writer');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(screen.getByText('stale')).toBeTruthy();
    expect(within(stepNow(0)).getByRole('alert').textContent).toContain('unknown specialist');
    openPreview();
    expect(screen.getByTestId('graph')).toBeTruthy();
    expect(screen.getAllByText('stale')).toHaveLength(2);
    expect(screen.getByText(/errors on the «Form» tab/)).toBeTruthy();
    expect(screen.queryAllByRole('listitem', { name: /^step \d+$/ })).toHaveLength(0);
  });

  it('drops the answer to an older draft', async () => {
    vi.useFakeTimers();
    const resolvers: ((value: { topology: ReturnType<typeof workflowOf>; errors: [] }) => void)[] =
      [];
    const previewWorkflow = vi.fn(
      () =>
        new Promise<{ topology: ReturnType<typeof workflowOf>; errors: [] }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    render(<Page api={api({ previewWorkflow })} start="feature" />);
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
    const topology = (id: string) => ({
      ...workflowOf(),
      steps: [{ ...workflowOf().steps[0]!, id }],
    });
    await act(async () => {
      resolvers[1]!({ topology: topology('fresh'), errors: [] });
    });
    await act(async () => {
      resolvers[0]!({ topology: topology('old'), errors: [] });
    });
    openPreview();
    expect(screen.getByTestId('graph').textContent).toBe('fresh');
  });
});

describe('tabs', () => {
  it('shows the form first and the graph on the preview tab, keeping the draft', async () => {
    const writeWorkflow = vi.fn(async () => ({ ok: true as const, revision: 'n', file: '/f' }));
    const previewWorkflow = vi.fn(async () => ({ topology: workflowOf(), errors: [] }));
    render(<Page api={api({ writeWorkflow, previewWorkflow })} start="feature" />);
    await stepBox(0);
    expect(screen.getByRole('tab', { name: /Form/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('graph')).toBeNull();
    await waitFor(() => expect(previewWorkflow).toHaveBeenCalled());
    openPreview();
    expect(screen.getByTestId('graph')).toBeTruthy();
    expect(screen.queryAllByRole('listitem', { name: /^step \d+$/ })).toHaveLength(0);
    openForm();
    expect(screen.queryByTestId('graph')).toBeNull();
    fireEvent.change(screen.getAllByLabelText('additional step prompt')[0]!, {
      target: { value: 'plan2' },
    });
    openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeWorkflow).toHaveBeenCalled());
    const written = writeWorkflow.mock.calls[0] as unknown as [
      string,
      { steps: { additional_prompt: string }[] },
    ];
    expect(written[1].steps[0]?.additional_prompt).toBe('plan2');
  });

  it('marks the preview tab as outdated and keeps the errors on the form', async () => {
    const previewWorkflow = vi.fn(async () => ({
      topology: null,
      errors: [
        { path: 'swarm.workflows.feature.steps[0].specialist', message: 'unknown specialist `x`' },
      ],
    }));
    render(<Page api={api({ previewWorkflow })} start="feature" />);
    await stepBox(0);
    await waitFor(() => expect(previewWorkflow).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(screen.getByRole('tab', { name: /Preview/ })).getByText('stale')).toBeTruthy(),
    );
    expect(within(await stepBox(0)).getByRole('alert').textContent).toContain('unknown specialist');
    openPreview();
    expect(screen.getByText(/errors on the «Form» tab/)).toBeTruthy();
  });
});

describe('saving and deleting', () => {
  it('says that new runs get the change and clears the unsaved state', async () => {
    const writeWorkflow = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writeWorkflow })} start="feature" />);
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
    const writeWorkflow = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: 'invalid',
        errors: [
          {
            path: 'swarm.workflows.feature.steps[1].on_reject.max_rounds',
            message: 'must be an integer from 1 to 10',
          },
        ],
      })
      .mockResolvedValueOnce({ ok: false, reason: 'conflict', message: 'file changed' });
    const config = vi.fn(async () => configView({ specialists, workflows: [entry('feature')] }));
    render(<Page api={fakeApi({ config, writeWorkflow })} start="feature" />);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Reread the workflow' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reread' }));
    await waitFor(() => expect(config).toHaveBeenCalledTimes(2));
  });

  it('names the active runs when deleting a workflow', async () => {
    const deleteWorkflow = vi.fn(async () => ({ ok: true as const, revision: null, file: '/f' }));
    render(
      <Page
        api={api({ deleteWorkflow })}
        start="feature"
        runs={[
          runView({ workflow: 'feature' }),
          runView({ id: 'done', workflow: 'feature', finished: true }),
        ]}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Runs in progress: 1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(deleteWorkflow).toHaveBeenCalledWith('feature', 'rev-feature', 'project'),
    );
    expect((await screen.findAllByText('Workflow «feature» deleted')).length).toBeGreaterThan(0);
  });

  it('saves a copy under a new id and creates a workflow from an empty form', async () => {
    const writeWorkflow = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writeWorkflow })} start="feature" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save as…' }));
    fireEvent.change(screen.getByLabelText('New id'), { target: { value: 'feature-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create a copy' }));
    await waitFor(() =>
      expect(writeWorkflow).toHaveBeenCalledWith('feature-2', expect.anything(), null, 'project'),
    );
    cleanup();
    writeWorkflow.mockClear();
    render(<Page api={api({ writeWorkflow })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New workflow' }));
    fireEvent.change(await screen.findByLabelText('Id'), { target: { value: 'quick' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    choose(within(await stepBox(0)).getByRole('combobox', { name: 'step specialist' }), 'coder');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writeWorkflow).toHaveBeenCalledWith(
        'quick',
        { steps: [{ id: 'coder', specialist: 'coder' }] },
        null,
        'project',
      ),
    );
  });
});

describe('draft conversion', () => {
  it('round-trips a workflow with split and a prompt on a step', () => {
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
      workflows: [entry('feature'), entry('quick')],
    });
    render(<Page api={fakeApi({ config: vi.fn(async () => view) })} start="feature" />);
    fireEvent.change(
      (await stepBox(0)).querySelector('textarea[aria-label="additional step prompt"]')!,
      {
        target: { value: 'analysis' },
      },
    );
    const list = screen.getByRole('list', { name: 'workflow' });
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
      file: '/xdg/aip/workflows/quick.yaml',
      revision: null,
      raw: { steps: [{ id: 'code', specialist: 'coder' }] },
    });

  it('edits a global workflow, previews and writes it with level global', async () => {
    const writeWorkflow = vi.fn(async () => ({ ok: true as const, revision: 'n', file: '/f' }));
    const previewWorkflow = vi.fn(async () => ({ topology: null, errors: [] }));
    const config = vi.fn(async () => configView({ specialists, workflows: [globalEntry()] }));
    render(<Page api={fakeApi({ config, writeWorkflow, previewWorkflow })} start="quick" />);
    expect(await screen.findByText(/applies in every repository/)).toBeTruthy();
    await waitFor(() =>
      expect(previewWorkflow).toHaveBeenCalledWith('quick', expect.anything(), 'global'),
    );
    fireEvent.change(screen.getAllByLabelText('additional step prompt')[0]!, {
      target: { value: 'build' },
    });
    openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writeWorkflow).toHaveBeenCalledWith(
        'quick',
        expect.anything(),
        'global-quick.yaml',
        'global',
      ),
    );
  });

  it('makes a project workflow global', async () => {
    const writeWorkflow = vi.fn(async () => ({ ok: true as const, revision: 'n', file: '/f' }));
    render(<Page api={api({ writeWorkflow })} start="feature" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make global' }));
    await waitFor(() => expect(writeWorkflow).toHaveBeenCalledWith('feature', RAW, null, 'global'));
  });
});

describe('step ids follow the specialist', () => {
  const saved = async (writeWorkflow: ReturnType<typeof vi.fn>) => {
    await waitFor(() => expect(writeWorkflow).toHaveBeenCalled());
    return (writeWorkflow.mock.calls[0] as unknown as [string, ReturnType<typeof valueOf>])[1];
  };

  it('has no id field in the step card', async () => {
    render(<Page api={api()} start="feature" />);
    await stepBox(0);
    expect(screen.queryByLabelText('step id')).toBeNull();
  });

  it('writes ids from the specialists of a new workflow, with a suffix for a repeat', async () => {
    const writeWorkflow = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    window.location.hash = '#workflows/new';
    render(<App api={api({ writeWorkflow })} openStream={openFake} />);
    fireEvent.change(await screen.findByLabelText('Id'), { target: { value: 'quick' } });
    for (const slug of ['plan', 'coder', 'coder']) {
      fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
      const index = screen.getAllByRole('listitem', { name: /^step \d+$/ }).length - 1;
      choose(within(stepNow(index)).getByRole('combobox', { name: 'step specialist' }), slug);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const value = await saved(writeWorkflow);
    expect(value).toEqual({
      steps: [
        { id: 'plan', specialist: 'plan' },
        { id: 'coder', specialist: 'coder' },
        { id: 'coder-2', specialist: 'coder' },
      ],
    });
  });

  it('keeps an own id from the file after another field is edited', async () => {
    const writeWorkflow = vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));
    render(<Page api={api({ writeWorkflow })} start="feature" />);
    fireEvent.change(
      (await stepBox(1)).querySelector(`textarea[aria-label="additional step prompt"]`)!,
      { target: { value: 'be careful' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const value = await saved(writeWorkflow);
    expect((value.steps as { id: string }[]).map((step) => step.id)).toEqual([
      'plan',
      'code',
      'review',
    ]);
  });

  it('shows the id of a new step in the preview after its specialist changes', async () => {
    const previewWorkflow = vi.fn(async () => ({ topology: workflowOf(), errors: [] }));
    const lastPreviewId = () => {
      const last = previewWorkflow.mock.calls.at(-1) as unknown as [
        string,
        { steps: { id: string }[] },
      ];
      return last[1].steps[3]?.id;
    };
    // the preview of a draft waits for the end of the edits: a fake clock instead of the real delay
    vi.useFakeTimers();
    render(<Page api={api({ previewWorkflow })} start="feature" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    choose(within(stepNow(3)).getByRole('combobox', { name: 'step specialist' }), 'writer');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(lastPreviewId()).toBe('writer');
    choose(within(stepNow(3)).getByRole('combobox', { name: 'step specialist' }), 'reviewer');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    });
    expect(lastPreviewId()).toBe('reviewer');
  });
});
