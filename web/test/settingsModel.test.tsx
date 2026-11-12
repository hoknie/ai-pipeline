// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';

import { chooseModel, modelValue } from './modelField.ts';
import { choose, cleanup, fireEvent, render, screen, waitFor } from './render.tsx';
import { configView, fakeApi, modelsView, openFake, queueOf, settingsOf } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '#settings/global/general';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FIELD = 'Naming model';

const catalog = (claude = {}) =>
  vi.fn(async () =>
    modelsView({
      runtimes: {
        claude: {
          models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', group: 'anthropic' }],
          error: null,
          ...claude,
        },
        opencode: {
          models: [{ id: 'openai/gpt-5', name: 'gpt-5', group: 'openai' }],
          error: null,
        },
        agy: { models: [], error: null },
      },
    }),
  );

const config = (model: string, runtime = 'claude') =>
  vi.fn(async () =>
    configView({
      settings: settingsOf({
        'naming.runtime': { path: 'naming.runtime', value: runtime, written: {} },
        'naming.model': { path: 'naming.model', value: model, written: {} },
      }),
    }),
  );

function show(overrides = {}) {
  const api = fakeApi({ queue: vi.fn(async () => queueOf()), ...overrides });
  render(<App api={api} openStream={openFake} />);
  return api;
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('the naming model of the settings', () => {
  it('shows the name and the id of the model', async () => {
    show({ config: config('claude-sonnet-5-5'), models: catalog() });
    const field = await screen.findByRole('combobox', { name: FIELD });
    await waitFor(() => expect(field.textContent).toContain('Sonnet 5.5'));
    expect(field.textContent).toContain('claude-sonnet-5-5');
  });

  it('writes the id of the model chosen by its name', async () => {
    const api = show({ config: config('haiku'), models: catalog() });
    fireEvent.click(await screen.findByRole('combobox', { name: FIELD }));
    fireEvent.click(await screen.findByRole('option', { name: /Sonnet 5\.5/ }));
    expect(modelValue(FIELD)).toBe('claude-sonnet-5-5');
    save();
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith(
        { 'naming.model': 'claude-sonnet-5-5' },
        'g1',
        'global',
      ),
    );
  });

  it('lets an id be typed when the runtime gives no list, and says why', async () => {
    const api = show({
      config: config(''),
      models: catalog({ models: [], error: 'claude is not installed' }),
    });
    fireEvent.click(await screen.findByRole('combobox', { name: FIELD }));
    expect((await screen.findByRole('alert')).textContent).toContain('claude is not installed');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await chooseModel('my-model', FIELD);
    save();
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith(
        { 'naming.model': 'my-model' },
        'g1',
        'global',
      ),
    );
  });

  it('takes the models of the runtime of the draft and keeps the value', async () => {
    show({ config: config('openai/gpt-5'), models: catalog() });
    const field = await screen.findByRole('combobox', { name: FIELD });
    await waitFor(() => expect(field.textContent).toContain('not in the list'));
    choose(screen.getByRole('combobox', { name: 'Naming runtime' }), 'opencode');
    await waitFor(() => expect(field.textContent).not.toContain('not in the list'));
    expect(field.textContent).toContain('gpt-5');
    expect(modelValue(FIELD)).toBe('openai/gpt-5');
  });
});
