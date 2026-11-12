// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttemptHeading } from '../src/features/runs/group/AttemptParts.tsx';
import type { AttemptView, EditorChain } from '../src/shared/api/types.ts';
import SpecialistsPage from '../src/features/specialists/SpecialistsPage.tsx';
import { ChainForm } from '../src/features/specialists/chains/ChainForm.tsx';
import type { Api } from '../src/shared/api/api.ts';
import { configView, fakeApi, specialistEntry } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { chooseModel, modelValue, modelValues } from './modelField.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const attempt = {
  seq: 1,
  stepId: 'code',
  stepName: 'Code',
  round: 1,
  specialist: 'coder',
  runtime: 'opencode',
  model: 'openai/gpt-6.1-sol',
  durationMs: 1000,
  usage: null,
  denials: [],
  outsideChanges: [],
  interrupting: false,
} as unknown as AttemptView;

function Page({ api, start = null }: { api: Api; start?: string | null }) {
  const [selected, setSelected] = useState<string | null>(start);
  return <SpecialistsPage api={api} selected={selected} onSelect={setSelected} />;
}

describe('attempt model identity', () => {
  it('shows the complete model ID and keeps it in the tooltip', () => {
    render(<AttemptHeading attempt={attempt} verdict="passed" />);
    const model = screen.getByTitle('coder · opencode openai/gpt-6.1-sol');
    expect(model.textContent).toBe('openai/gpt-6.1-sol');
  });

  it('renders an old short model exactly as stored', () => {
    render(<AttemptHeading attempt={{ ...attempt, model: 'gpt-short' }} verdict="failed" />);
    expect(screen.getByTitle('coder · opencode gpt-short').textContent).toBe('gpt-short');
  });
});

describe('specialist form model identity', () => {
  it('preserves full ID in save, reopen, and allows correcting an invalid short model', async () => {
    let currentModel = 'openai/gpt-6.1-sol';
    const writeSpecialist = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: false as const,
        reason: 'invalid' as const,
        errors: [
          {
            file: '/repo/aip/specialists/coder.yaml',
            path: 'swarm.specialists.coder.model',
            message:
              'OpenCode model "gpt-short" must use provider/model format, for example openai/gpt-6.1-sol',
          },
        ],
      }))
      .mockImplementationOnce(async (_slug: string, value: { model?: string }) => {
        if (value.model) currentModel = value.model;
        return { ok: true as const, revision: 'rev2', file: '/repo/aip/specialists/coder.yaml' };
      });

    const makeView = () =>
      configView({
        specialists: [
          specialistEntry(
            'coder',
            { raw: { name: 'Кодировщик', runtime: 'opencode', model: currentModel } },
            { name: 'Кодировщик', runtime: 'opencode', model: currentModel },
          ),
        ],
      });

    const api = fakeApi({
      writeSpecialist,
      config: vi.fn(async () => makeView()),
    });

    const { unmount } = render(<Page api={api} start="coder" />);
    await screen.findByRole('combobox', { name: 'Model' });
    expect(modelValue()).toBe('openai/gpt-6.1-sol');

    // Attempt invalid short model
    await chooseModel('gpt-short');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalledTimes(1));

    // Error is displayed
    const errorAlert = await screen.findByText(/must use provider\/model format/);
    expect(errorAlert).toBeTruthy();

    // Fix error with valid full model
    await chooseModel('openai/gpt-6.1-fixed');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeSpecialist).toHaveBeenCalledTimes(2));
    expect(writeSpecialist).toHaveBeenLastCalledWith(
      'coder',
      expect.objectContaining({ model: 'openai/gpt-6.1-fixed' }),
      'rev-coder',
      'project',
    );

    // Reopen form and verify model persists
    unmount();
    render(<Page api={api} start="coder" />);
    await screen.findByRole('combobox', { name: 'Model' });
    expect(modelValue()).toBe('openai/gpt-6.1-fixed');
  });
});

describe('chain form model identity', () => {
  it('preserves full model IDs in chain elements after reordering', async () => {
    const rawChain = {
      name: 'Qualified models',
      mode: 'on_error' as const,
      enabled: true,
      runtimes: [
        { runtime: 'opencode' as const, model: 'openai/gpt-alpha', enabled: true },
        { runtime: 'opencode' as const, model: 'OtherProvider/team/GPT-beta', enabled: true },
      ],
    };
    const chain: EditorChain = {
      slug: 'qualified-chain',
      level: 'project',
      file: '/repo/aip/chains/qualified-chain.yaml',
      revision: 'c1',
      raw: rawChain,
      sources: {
        project: {
          file: '/repo/aip/chains/qualified-chain.yaml',
          revision: 'c1',
          raw: rawChain,
        },
      },
    };
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'c2',
      file: '/repo/aip/chains/qualified-chain.yaml',
    }));

    render(
      <ChainForm
        api={fakeApi({ writeChain })}
        chain={chain}
        onDirty={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
        onDeleted={vi.fn(async () => undefined)}
      />,
    );

    expect(modelValues().filter((value) => value === 'openai/gpt-alpha')).toHaveLength(1);
    expect(modelValues().filter((value) => value === 'OtherProvider/team/GPT-beta')).toHaveLength(
      1,
    );

    const moveUp = screen.getAllByRole('button', { name: 'Move up' });
    fireEvent.click(moveUp[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writeChain).toHaveBeenCalled());
    const saved = (writeChain.mock.calls[0] as unknown[])[1] as typeof rawChain;
    expect(saved.runtimes.map((r) => r.model)).toEqual([
      'OtherProvider/team/GPT-beta',
      'openai/gpt-alpha',
    ]);
  });
});
