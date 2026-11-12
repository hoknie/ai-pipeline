// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelEntry } from '../src/shared/api/types.ts';
import { ModelPicker } from '../src/shared/ui/forms/ModelPicker.tsx';
import { groupModels, matchingModels } from '../src/shared/ui/forms/picker/modelParts.ts';

import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(cleanup);

const MODELS: ModelEntry[] = [
  { id: 'opus', name: 'opus', group: 'aliases' },
  { id: 'openai/gpt-5', name: 'gpt-5', group: 'openai' },
  {
    id: 'openrouter/anthropic/claude-opus-5-5',
    name: 'anthropic/claude-opus-5-5',
    group: 'openrouter',
  },
];

function Harness({
  start = '',
  ...rest
}: { start?: string } & Partial<Parameters<typeof ModelPicker>[0]>) {
  const [value, setValue] = useState(start);
  return <ModelPicker label="Model" value={value} onChange={setValue} models={MODELS} {...rest} />;
}

const open = async () => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
  return screen.findByRole('combobox', { name: 'Search in Model' });
};

const held = () => screen.getByRole('combobox', { name: 'Model' }).getAttribute('data-value');

describe('matchingModels and groupModels', () => {
  it('search the id and the short name without case', () => {
    expect(matchingModels(MODELS, '').length).toBe(3);
    expect(matchingModels(MODELS, 'GPT').map((model) => model.id)).toEqual(['openai/gpt-5']);
    expect(matchingModels(MODELS, 'openrouter/').map((model) => model.group)).toEqual([
      'openrouter',
    ]);
    expect(matchingModels(MODELS, 'nothing')).toEqual([]);
  });

  it('keep the groups in the order they appear', () => {
    expect(groupModels(MODELS).map((entry) => entry.group)).toEqual([
      'aliases',
      'openai',
      'openrouter',
    ]);
  });
});

describe('ModelPicker', () => {
  it('shows groups with short names and the muted full id, and picks a model', async () => {
    render(<Harness />);
    await open();
    expect(screen.getByText('Aliases')).toBeTruthy();
    expect(screen.getByText('openai')).toBeTruthy();
    expect(screen.getByText('gpt-5')).toBeTruthy();
    expect(screen.getByText('openai/gpt-5')).toBeTruthy();
    fireEvent.click(screen.getByText('gpt-5'));
    expect(held()).toBe('openai/gpt-5');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('keeps a value that is not in the list and marks it', async () => {
    render(<Harness />);
    const search = await open();
    fireEvent.change(search, { target: { value: 'my/own-model' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Use «my/own-model»' }));
    expect(held()).toBe('my/own-model');
    expect(screen.getByText('not in the list')).toBeTruthy();
  });

  it('does not mark a value when there is no list to compare with', () => {
    render(<Harness start="my/own-model" models={[]} />);
    expect(screen.queryByText('not in the list')).toBeNull();
  });

  it('resets to the default and shows what the default is', async () => {
    render(<Harness start="opus" placeholder="from defaults: sonnet" />);
    await open();
    fireEvent.click(screen.getByRole('option', { name: 'Default' }));
    expect(held()).toBe('');
    expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toContain(
      'from defaults: sonnet',
    );
  });

  it('shows the error of the runtime and still accepts a typed value', async () => {
    render(<Harness models={[]} error="opencode: command not found" />);
    const search = await open();
    expect(screen.getByRole('alert').textContent).toBe('opencode: command not found');
    fireEvent.change(search, { target: { value: 'openai/gpt-5' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Use «openai/gpt-5»' }));
    expect(held()).toBe('openai/gpt-5');
  });

  it('asks for a refresh and is busy while it loads', async () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<Harness onRefresh={onRefresh} />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    rerender(<Harness onRefresh={onRefresh} loading />);
    expect(screen.getByText('Loading models…')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Refresh list' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
