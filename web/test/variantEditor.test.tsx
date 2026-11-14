// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PipelinesPage from '../src/features/pipelines/PipelinesPage.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { EditorChain, EditorPipeline } from '../src/shared/api/types.ts';

import { flow } from './fakeFlow.tsx';
import { choose, cleanup, fireEvent, openTab, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, modelsView, sourcesFor, specialistEntry } from './fixtures.ts';

vi.mock('@xyflow/react', async () => (await import('./fakeFlow.tsx')).fakeFlow());

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STEPS = [
  { id: 'plan', specialist: 'plan' },
  { id: 'code', specialist: 'coder' },
  { id: 'review', specialist: 'reviewer', additional_prompt: 'check the diff' },
];

function entry(variants: Record<string, unknown>): EditorPipeline {
  const base = {
    id: 'feature',
    level: 'project' as const,
    file: '/repo/aip/pipelines/feature.yaml',
    revision: 'rev',
    raw: { steps: STEPS, variants },
    shared_tags: [] as string[],
    own_tags: [] as string[],
  };
  return { ...base, sources: sourcesFor('pipelines', base) };
}

const chain: EditorChain = (() => {
  const base = {
    slug: 'fallback',
    level: 'project' as const,
    file: '/repo/aip/chains/fallback.yaml',
    revision: 'c1',
    raw: { name: 'Fallback' },
  };
  return { ...base, sources: sourcesFor('specialists', base) };
})();

const saved = () => vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));

function api(
  variants: Record<string, unknown>,
  writePipeline = saved(),
  opencode: string[] = [],
  chained: string[] = [],
): Api {
  const specialists = ['plan', 'coder', 'reviewer', 'writer'].map((slug) =>
    specialistEntry(
      slug,
      chained.includes(slug) ? { raw: { name: slug, runtime_chain: 'fallback' } } : {},
      {
        name: slug,
        runtime: opencode.includes(slug) ? 'opencode' : 'claude',
      },
    ),
  );
  return fakeApi({
    config: vi.fn(async () =>
      configView({ specialists, pipelines: [entry(variants)], chains: [chain] }),
    ),
    writePipeline,
  });
}

function Page({ api }: { api: Api }) {
  const [selected, setSelected] = useState<string | null>('feature');
  return <PipelinesPage api={api} runs={[]} selected={selected} onSelect={setSelected} />;
}

const open = async (variant: string) => {
  const switcher = await screen.findByRole('radiogroup', { name: 'Pipeline variants' });
  fireEvent.click(within(switcher).getByRole('radio', { name: variant }));
};
const card = (title: string) => within(screen.getByRole('listitem', { name: title }));
const variantsWritten = (writePipeline: ReturnType<typeof saved>) =>
  (writePipeline.mock.calls.at(-1) as unknown as [string, Record<string, unknown>])[1].variants;
const pressSave = async (writePipeline: ReturnType<typeof saved>) => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(writePipeline).toHaveBeenCalled());
};
const pickModel = async (scope: ReturnType<typeof card>, model: string) => {
  fireEvent.click(scope.getByRole('combobox', { name: 'Model' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'Search in Model' }), {
    target: { value: `custom-${model}` },
  });
  fireEvent.click(await screen.findByRole('option', { name: `Use «custom-${model}»` }));
};

describe('the cards of a variant', () => {
  it('writes only the fields that were set', async () => {
    const writePipeline = saved();
    render(<Page api={api({ strong: {} }, writePipeline)} />);
    await open('strong');
    await pickModel(card('Step code'), 'opus');
    await pressSave(writePipeline);
    expect(variantsWritten(writePipeline)).toEqual({
      strong: { steps: { code: { model: 'custom-opus' } } },
    });
  });

  it('gives the model back to the pipeline when a chain is chosen', async () => {
    const writePipeline = saved();
    render(<Page api={api({ strong: { steps: { code: { model: 'opus' } } } }, writePipeline)} />);
    await open('strong');
    choose(card('Step code').getByRole('combobox', { name: 'Executor chain' }), /Fallback/);
    await pressSave(writePipeline);
    expect(variantsWritten(writePipeline)).toEqual({
      strong: { steps: { code: { runtime_chain: 'fallback' } } },
    });
  });

  it('lets a variant inherit or choose a chain and hides executor fields while it does', async () => {
    const writePipeline = saved();
    render(<Page api={api({ strong: {} }, writePipeline)} />);
    await open('strong');
    const step = card('Step code');
    const chainSelect = step.getByRole('combobox', { name: 'Executor chain' });
    expect(chainSelect.textContent).toContain('as in the pipeline');
    choose(chainSelect, /Fallback/);
    expect(step.getByRole('combobox', { name: 'Specialist' })).toBeTruthy();
    expect(step.queryByRole('combobox', { name: 'Executor' })).toBeNull();
    expect(step.queryByRole('combobox', { name: 'Model' })).toBeNull();
    choose(step.getByRole('combobox', { name: 'Executor chain' }), /as in the pipeline/);
    expect(step.getByRole('combobox', { name: 'Specialist' })).toBeTruthy();
    expect(step.getByRole('combobox', { name: 'Model' })).toBeTruthy();
    choose(step.getByRole('combobox', { name: 'Executor chain' }), /Fallback/);
    await pressSave(writePipeline);
    expect(variantsWritten(writePipeline)).toEqual({
      strong: { steps: { code: { runtime_chain: 'fallback' } } },
    });
  });

  it('keeps the specialist choice when the specialist of the step has a chain', async () => {
    const writePipeline = saved();
    render(<Page api={api({ strong: {} }, writePipeline, [], ['coder'])} />);
    await open('strong');
    const step = card('Step code');
    choose(step.getByRole('combobox', { name: 'Specialist' }), /writer/);
    await pressSave(writePipeline);
    expect(variantsWritten(writePipeline)).toEqual({
      strong: { steps: { code: { specialist: 'writer' } } },
    });
  });

  it('lets a variant replace an inherited chain with an own executor', async () => {
    const writePipeline = saved();
    render(<Page api={api({ strong: {} }, writePipeline, [], ['coder'])} />);
    await open('strong');
    const step = card('Step code');
    expect(step.getByRole('combobox', { name: 'Executor chain' }).textContent).toContain(
      'Fallback',
    );
    choose(step.getByRole('combobox', { name: 'Executor chain' }), 'No chain');
    choose(step.getByRole('combobox', { name: 'Executor' }), 'opencode');
    await pressSave(writePipeline);
    expect(variantsWritten(writePipeline)).toEqual({
      strong: { steps: { code: { runtime: 'opencode' } } },
    });
  });

  it('hides the executor and the model while the specialist chain stays, and no chain brings them back', async () => {
    const writePipeline = saved();
    render(<Page api={api({ strong: {} }, writePipeline, [], ['coder'])} />);
    await open('strong');
    const step = card('Step code');
    expect(step.queryByRole('combobox', { name: 'Executor' })).toBeNull();
    expect(step.queryByRole('combobox', { name: 'Model' })).toBeNull();
    choose(step.getByRole('combobox', { name: 'Executor chain' }), 'No chain');
    expect(step.getByRole('combobox', { name: 'Executor' })).toBeTruthy();
    expect(step.getByRole('combobox', { name: 'Model' })).toBeTruthy();
    await pressSave(writePipeline);
    expect(variantsWritten(writePipeline)).toEqual({
      strong: { steps: { code: { runtime: 'claude' } } },
    });
    choose(step.getByRole('combobox', { name: 'Executor chain' }), /as in the pipeline/);
    expect(step.queryByRole('combobox', { name: 'Executor' })).toBeNull();
    expect(step.queryByRole('combobox', { name: 'Model' })).toBeNull();
  });

  it('loads model options for the selected runtime and changes them with the executor', async () => {
    const models = vi.fn(async () => modelsView());
    const testApi = { ...api({ light: {} }), models } as Api;
    render(<Page api={testApi} />);
    await open('light');
    const step = card('Step code');
    fireEvent.click(step.getByRole('combobox', { name: 'Model' }));
    expect(await screen.findByText('opus')).toBeTruthy();
    expect(models).toHaveBeenCalledWith(false);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search in Model' }), {
      key: 'Escape',
    });

    choose(step.getByRole('combobox', { name: 'Executor' }), 'opencode');
    fireEvent.click(step.getByRole('combobox', { name: 'Model' }));
    expect(await screen.findByText('gpt-5')).toBeTruthy();
    expect(screen.queryByText('opus')).toBeNull();
  });

  it('removes the additional prompt of a step', async () => {
    const writePipeline = saved();
    render(<Page api={api({ light: {} }, writePipeline)} />);
    await open('light');
    choose(
      card('Step review').getByRole('combobox', { name: 'additional prompt: choice' }),
      'remove',
    );
    await pressSave(writePipeline);
    expect(variantsWritten(writePipeline)).toEqual({
      light: { steps: { review: { additional_prompt: null } } },
    });
  });

  it('restores the three states of the prompt from the file', async () => {
    render(
      <Page
        api={api({
          light: {
            steps: { plan: { additional_prompt: 'own' }, review: { additional_prompt: null } },
          },
        })}
      />,
    );
    await open('light');
    const prompt = (title: string) =>
      card(title).getByRole('combobox', { name: 'additional prompt: choice' }).textContent;
    expect(prompt('Step plan')).toBe('own text');
    expect(prompt('Step review')).toBe('remove');
    expect(prompt('Step code')).toBe('as in the pipeline');
    expect(
      (card('Step plan').getByLabelText('additional prompt: text') as HTMLTextAreaElement).value,
    ).toBe('own');
  });

  it('shows the options of OpenCode only for an OpenCode executor', async () => {
    render(<Page api={api({ light: {} }, saved(), ['coder'])} />);
    await open('light');
    expect(card('Step code').queryByRole('combobox', { name: 'Reasoning effort' })).toBeTruthy();
    expect(card('Step code').queryByLabelText('Model variant')).toBeTruthy();
    expect(card('Step plan').queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull();
    expect(card('Step plan').queryByLabelText('Model variant')).toBeNull();
  });
});

describe('the id of a variant', () => {
  it('reports an id of another variant and does not allow saving', async () => {
    const writePipeline = saved();
    render(<Page api={api({ light: {}, strong: {} }, writePipeline)} />);
    await open('strong');
    fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'light' } });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A variant with this id already exists',
    );
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'strong-2' } });
    expect(screen.queryByRole('alert')).toBeNull();
    await pressSave(writePipeline);
    expect(Object.keys(variantsWritten(writePipeline) as object)).toEqual(['light', 'strong-2']);
  });
});

describe('the diagram of a variant', () => {
  it('marks the skipped steps, shows the specialists of the variant and cannot be changed', async () => {
    render(
      <Page
        api={api({ light: { skip: ['review'], steps: { code: { specialist: 'writer' } } } })}
      />,
    );
    await open('light');
    openTab(/Diagram/);
    const nodes = await screen.findAllByTestId(/^canvas-node-step:/);
    const byTitle = (title: string) =>
      nodes.find((node) => node.querySelector('.font-medium')?.textContent === title)!;
    expect(byTitle('review').dataset.skipped).toBe('true');
    expect(byTitle('code').dataset.skipped).toBeUndefined();
    expect(byTitle('code').textContent).toContain('writer');
    expect(screen.getByText(/Edit the variant on the «Form» tab/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a step here' })).toBeNull();
    expect(flow.props!.nodesDraggable).toBe(false);
    expect(flow.props!.nodesConnectable).toBe(false);
  });

  it('keeps the automatic id of a step whose specialist the variant replaces', async () => {
    render(<Page api={api({ light: { steps: { plan: { specialist: 'writer' } } } })} />);
    await open('light');
    openTab(/Diagram/);
    const nodes = await screen.findAllByTestId(/^canvas-node-step:/);
    const titles = nodes.map((node) => node.querySelector('.font-medium')?.textContent);
    expect(titles).toEqual(['plan', 'code', 'review']);
    expect(nodes[0]!.textContent).toContain('writer');
  });

  it('shows the pipeline itself for default', async () => {
    render(<Page api={api({ light: { skip: ['review'] } })} />);
    await screen.findByRole('radiogroup', { name: 'Pipeline variants' });
    openTab(/Diagram/);
    const nodes = await screen.findAllByTestId(/^canvas-node-step:/);
    expect(nodes.some((node) => node.dataset.skipped === 'true')).toBe(false);
    expect(flow.props!.nodesDraggable).toBe(true);
  });
});
