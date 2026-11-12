// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChainForm } from '../src/features/specialists/chains/ChainForm.tsx';
import SpecialistsPage from '../src/features/specialists/SpecialistsPage.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { EditorChain } from '../src/shared/api/types.ts';
import { ModelCatalogProvider } from '../src/shared/lib/catalog/models.tsx';

import { modelValue, modelValues } from './modelField.ts';
import { configView, fakeApi, modelsView, specialistEntry } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(cleanup);

function Page({ api, start }: { api: Api; start: string }) {
  const [selected, setSelected] = useState<string | null>(start);
  return <SpecialistsPage api={api} selected={selected} onSelect={setSelected} />;
}

const okWrite = () => vi.fn(async () => ({ ok: true as const, revision: 'r2', file: '/f' }));

function specialistApi(runtime: string, model: string, overrides: Partial<Api> = {}) {
  const raw = { name: 'Кодировщик', runtime, ...(model ? { model } : {}) };
  const entry = specialistEntry('coder', { raw }, raw);
  return fakeApi({ config: vi.fn(async () => configView({ specialists: [entry] })), ...overrides });
}

describe('model choice in the specialist form', () => {
  it('picks an OpenCode model from the group of its provider and saves the full id', async () => {
    const writeSpecialist = okWrite();
    render(<Page api={specialistApi('opencode', '', { writeSpecialist })} start="coder" />);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Model' }));
    expect(await screen.findByText('openrouter')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Search in Model' }), {
      target: { value: 'claude-opus' },
    });
    fireEvent.click(await screen.findByText('anthropic/claude-opus-5-5'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist).toHaveBeenCalledWith(
      'coder',
      { name: 'Кодировщик', runtime: 'opencode', model: 'openrouter/anthropic/claude-opus-5-5' },
      'rev-coder',
      'project',
    );
  });

  it('offers the aliases of Claude first and saves the alias', async () => {
    const writeSpecialist = okWrite();
    render(<Page api={specialistApi('claude', '', { writeSpecialist })} start="coder" />);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Model' }));
    const headings = await screen.findAllByText(/^(Aliases|anthropic)$/);
    expect(headings.map((heading) => heading.textContent)).toEqual(['Aliases', 'anthropic']);
    fireEvent.click(screen.getByRole('option', { name: 'sonnet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalled());
    expect(writeSpecialist.mock.calls[0]).toEqual([
      'coder',
      { name: 'Кодировщик', runtime: 'claude', model: 'sonnet' },
      'rev-coder',
      'project',
    ]);
  });

  it('uses the models of the runtime the form selects', async () => {
    render(<Page api={specialistApi('opencode', 'openai/gpt-5')} start="coder" />);
    const trigger = await screen.findByRole('combobox', { name: 'Model' });
    await waitFor(() => expect(trigger.textContent).toContain('gpt-5'));
    expect(trigger.textContent).toContain('openai/gpt-5');
    expect(screen.queryByText('not in the list')).toBeNull();
  });

  it('shows the form with the saved model before the models arrive', async () => {
    const models = vi.fn(() => new Promise<ReturnType<typeof modelsView>>(() => {}));
    render(<Page api={specialistApi('opencode', 'my/own', { models })} start="coder" />);
    await screen.findByRole('combobox', { name: 'Model' });
    expect(modelValue()).toBe('my/own');
    expect(screen.queryByText('not in the list')).toBeNull();
  });

  it('shows the error of OpenCode and keeps the field usable', async () => {
    const models = vi.fn(async () =>
      modelsView({
        runtimes: {
          ...modelsView().runtimes,
          opencode: { models: [], error: 'opencode: command not found' },
        },
      }),
    );
    render(<Page api={specialistApi('opencode', '', { models })} start="coder" />);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Model' }));
    expect((await screen.findByRole('alert')).textContent).toBe('opencode: command not found');
    fireEvent.change(screen.getByRole('combobox', { name: 'Search in Model' }), {
      target: { value: 'openai/gpt-5' },
    });
    fireEvent.click(await screen.findByRole('option', { name: 'Use «openai/gpt-5»' }));
    expect(modelValue()).toBe('openai/gpt-5');
  });
});

describe('model choice in a chain element', () => {
  const raw = {
    name: 'Fast then Strong',
    mode: 'on_error',
    enabled: true,
    runtimes: [
      { runtime: 'claude', model: 'haiku', enabled: true },
      { runtime: 'opencode', model: '', enabled: true },
    ],
  };
  const chain: EditorChain = {
    slug: 'fast-to-strong',
    level: 'project',
    file: '/repo/aip/chains/fast-to-strong.yaml',
    revision: 'c1',
    raw,
    sources: { project: { file: '/repo/aip/chains/fast-to-strong.yaml', revision: 'c1', raw } },
  };

  function renderChain(api: Api) {
    render(
      <ModelCatalogProvider api={api}>
        <ChainForm
          api={api}
          chain={chain}
          onDirty={vi.fn()}
          onSaved={vi.fn(async () => undefined)}
          onDeleted={vi.fn(async () => undefined)}
        />
      </ModelCatalogProvider>,
    );
  }

  it('picks the model of an element from the models of its runtime', async () => {
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'c2',
      file: '/f',
    }));
    renderChain(fakeApi({ writeChain }));
    const pickers = await screen.findAllByRole('combobox', { name: 'Model' });
    expect(pickers).toHaveLength(2);
    fireEvent.click(pickers[1]!);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Search in Model' }), {
      target: { value: 'gpt' },
    });
    expect(screen.queryByText('sonnet')).toBeNull();
    fireEvent.click(await screen.findByText('gpt-5'));
    expect(modelValues()).toEqual(['haiku', 'openai/gpt-5']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeChain).toHaveBeenCalled());
    const saved = writeChain.mock.calls[0]?.[1] as typeof raw;
    expect(saved.runtimes.map((item) => item.model)).toEqual(['haiku', 'openai/gpt-5']);
  });

  it('gives every field the new list after a refresh', async () => {
    const models = vi
      .fn<(refresh?: boolean) => Promise<ReturnType<typeof modelsView>>>()
      .mockImplementation(async (refresh) =>
        refresh
          ? modelsView({
              runtimes: {
                ...modelsView().runtimes,
                opencode: {
                  models: [{ id: 'fresh/model-x', name: 'model-x', group: 'fresh' }],
                  error: null,
                },
              },
            })
          : modelsView(),
      );
    renderChain(fakeApi({ models }));
    const pickers = await screen.findAllByRole('combobox', { name: 'Model' });
    expect(models).toHaveBeenCalledTimes(1);
    expect(models).toHaveBeenLastCalledWith(false);
    fireEvent.click(pickers[1]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh list' }));
    await waitFor(() => expect(models).toHaveBeenLastCalledWith(true));
    expect(await screen.findByText('fresh')).toBeTruthy();
    expect(screen.getByText('model-x')).toBeTruthy();
    expect(screen.queryByText('openrouter')).toBeNull();
  });
});
