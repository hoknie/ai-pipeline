// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { ProvidersView } from '../src/shared/api/types.ts';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import {
  FakeSocket,
  fakeApi,
  openFake,
  pipelineOf,
  pipelinesView,
  queueItem,
  queueOf,
  repositoryView,
  runView,
} from './fixtures.ts';
import { providersView, providerView } from './providerFixtures.ts';

const APP = '/work/app';
const LIB = '/work/lib';

beforeEach(() => {
  window.location.hash = '#queue/new';
  window.localStorage.clear();
});
afterEach(() => cleanup());

const named = (slug: string, name = slug) => providerView(slug, { name });

/** The page of a new task in the project `app`, with its own registry per project. */
function mount(
  registries: Record<string, ProvidersView>,
  overrides: Parameters<typeof fakeApi>[0] = {},
) {
  const api = fakeApi({
    queue: vi.fn(async () => queueOf({ repository: APP, items: [queueItem('qa', 'app task', 1)] })),
    runs: vi.fn(async () => []),
    pipelines: vi.fn(async (repository?: string) =>
      pipelinesView({
        repository: repository ?? APP,
        pipelines: [pipelineOf({ id: 'feature' })],
      }),
    ),
    providers: vi.fn(async () => registries[APP]!),
    ...overrides,
  });
  const bind = api.forRepository;
  const scope = (path: string | null): Api => ({
    ...bind(path),
    forRepository: scope,
    providers: async () => registries[path ?? APP] ?? registries[APP]!,
  });
  api.forRepository = scope;
  render(<App api={api as Api} openStream={openFake} />);
  act(() => {
    FakeSocket.last?.send({
      event: 'snapshot',
      seq: 1,
      runs: [runView({ id: 'a1', repository: APP })],
      queues: [
        queueOf({ repository: APP, items: [queueItem('qa', 'app task', 1)] }),
        queueOf({ repository: LIB, items: [] }),
      ],
      repositories: [repositoryView(APP), repositoryView(LIB)],
    });
  });
  return api;
}

const text = () => screen.findByLabelText<HTMLTextAreaElement>('Task text');
const providerField = () => screen.findByRole<HTMLButtonElement>('combobox', { name: 'Provider' });

async function openProviders() {
  const field = await providerField();
  await waitFor(() => expect(field.disabled).toBe(false));
  fireEvent.click(field);
  return field;
}

async function addLib() {
  fireEvent.click(await screen.findByRole('button', { name: 'In several projects' }));
  fireEvent.click(await screen.findByRole('combobox', { name: 'Add project' }));
  const lib = (await screen.findAllByRole('option')).find((item) =>
    item.textContent?.startsWith('lib'),
  );
  fireEvent.click(lib!);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Move lib up' })).toBeTruthy());
}

describe('the provider of a task in several projects', () => {
  it('offers only the providers every chosen project knows', async () => {
    mount({
      [APP]: providersView({
        repository: APP,
        providers: [named('anthropic', 'Anthropic'), named('zai', 'Z.ai')],
      }),
      [LIB]: providersView({ repository: LIB, providers: [named('anthropic', 'Anthropic')] }),
    });
    await text();
    await addLib();
    await openProviders();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    const names = screen.getAllByRole('option').map((option) => option.textContent ?? '');
    expect(names[0]).toContain('Not chosen');
    expect(names[1]).toContain('Anthropic');
    expect(names[2]).toContain('Create provider…');
    expect(screen.queryByRole('option', { name: /Z\.ai/ })).toBeNull();
  });

  it('falls back to «Not chosen» when an added project does not know the provider', async () => {
    mount({
      [APP]: providersView({
        repository: APP,
        providers: [named('anthropic', 'Anthropic'), named('zai', 'Z.ai')],
      }),
      [LIB]: providersView({ repository: LIB, providers: [named('anthropic', 'Anthropic')] }),
    });
    await text();
    await openProviders();
    fireEvent.click(await screen.findByRole('option', { name: /Z\.ai/ }));
    await waitFor(async () => expect((await providerField()).textContent).toContain('Z.ai'));
    await addLib();
    await waitFor(async () => {
      const field = await providerField();
      expect(field.textContent).toContain('Not chosen');
      expect(field.textContent).not.toContain('Z.ai');
    });
  });
});

describe('creating a provider from the task form', () => {
  it('chooses the new provider and keeps the typed task text', async () => {
    const registries: Record<string, ProvidersView> = {
      [APP]: providersView({ repository: APP, providers: [named('anthropic', 'Anthropic')] }),
    };
    mount(registries, {
      writeProvider: vi.fn(async () => {
        registries[APP] = providersView({
          repository: APP,
          providers: [named('anthropic', 'Anthropic'), named('corp', 'Corp')],
        });
        return { ok: true as const, revision: 'r1' } as never;
      }),
    });
    fireEvent.change(await text(), { target: { value: 'Keep this text' } });
    await openProviders();
    fireEvent.change(await screen.findByPlaceholderText('Name or slug'), {
      target: { value: 'Corp' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Create provider…/ }));
    const dialog = await screen.findByRole('dialog', { name: /provider/i });
    const next = async () =>
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Next' }));
    await next();
    await next();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /provider/i })).toBeNull());
    await waitFor(async () => expect((await providerField()).textContent).toContain('Corp'));
    expect((await text()).value).toBe('Keep this text');
  });
});
