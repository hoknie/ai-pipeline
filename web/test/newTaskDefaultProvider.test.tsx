// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { ProvidersView } from '../src/shared/api/types.ts';

import { setMarkdown, act, cleanup, fireEvent, render, screen, waitFor } from './render.tsx';
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

/** A registry of a project with two providers and a default one (`null`: none). */
const registry = (repository: string, slug: string | null, enabled = true): ProvidersView =>
  providersView({
    repository,
    providers: [named('anthropic', 'Anthropic'), { ...named('zai', 'Z.ai'), enabled }],
    defaultProvider: slug === null ? null : { slug, level: 'global' },
  });

function mount(registries: Record<string, ProvidersView>) {
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

const text = () => screen.findByLabelText('Task text');
const providerField = () => screen.findByRole<HTMLButtonElement>('combobox', { name: 'Provider' });

async function openProviders() {
  const field = await providerField();
  await waitFor(() => expect(field.disabled).toBe(false));
  fireEvent.click(field);
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

describe('the default provider in the task form', () => {
  it('is chosen in a new task and sent without touching the field', async () => {
    const api = mount({ [APP]: registry(APP, 'anthropic') });
    setMarkdown(await text(), 'T');
    await waitFor(async () => expect((await providerField()).textContent).toContain('Anthropic'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(
        expect.objectContaining({ pipeline: 'feature', provider: 'anthropic', task: 'T' }),
      ),
    );
  });

  it('is marked «default» in the list of the field', async () => {
    mount({ [APP]: registry(APP, 'anthropic') });
    await text();
    await waitFor(async () => expect((await providerField()).textContent).toContain('Anthropic'));
    await openProviders();
    const options = await screen.findAllByRole('option');
    expect(options.find((o) => o.textContent?.includes('Anthropic'))?.textContent).toContain(
      'default',
    );
    expect(options.find((o) => o.textContent?.includes('Z.ai'))?.textContent).not.toContain(
      'default',
    );
  });

  it('can be refused with «Not chosen», which is sent as null', async () => {
    const api = mount({ [APP]: registry(APP, 'anthropic') });
    setMarkdown(await text(), 'T');
    await waitFor(async () => expect((await providerField()).textContent).toContain('Anthropic'));
    await openProviders();
    fireEvent.click(await screen.findByRole('option', { name: /Not chosen/ }));
    await waitFor(async () => expect((await providerField()).textContent).toContain('Not chosen'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(
        expect.objectContaining({ provider: null, task: 'T' }),
      ),
    );
  });

  it('sends null when the project has no default provider', async () => {
    const api = mount({ [APP]: registry(APP, null) });
    setMarkdown(await text(), 'T');
    await waitFor(async () => expect((await providerField()).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(expect.objectContaining({ provider: null })),
    );
  });

  it('is not chosen when the default provider is switched off', async () => {
    mount({ [APP]: registry(APP, 'zai', false) });
    await text();
    await waitFor(async () => expect((await providerField()).disabled).toBe(false));
    expect((await providerField()).textContent).toContain('Not chosen');
  });

  it('follows the project until the field is touched', async () => {
    mount({ [APP]: registry(APP, 'anthropic'), [LIB]: registry(LIB, 'zai') });
    await text();
    await waitFor(async () => expect((await providerField()).textContent).toContain('Anthropic'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Repository' }));
    fireEvent.click(
      (await screen.findAllByRole('option')).find((item) => item.textContent?.includes('lib'))!,
    );
    await waitFor(async () => expect((await providerField()).textContent).toContain('Z.ai'));
  });

  it('keeps a chosen provider the new project knows', async () => {
    mount({ [APP]: registry(APP, 'anthropic'), [LIB]: registry(LIB, 'zai') });
    await text();
    await waitFor(async () => expect((await providerField()).textContent).toContain('Anthropic'));
    await openProviders();
    fireEvent.click(await screen.findByRole('option', { name: /Z\.ai/ }));
    await waitFor(async () => expect((await providerField()).textContent).toContain('Z.ai'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Repository' }));
    fireEvent.click(
      (await screen.findAllByRole('option')).find((item) => item.textContent?.includes('lib'))!,
    );
    await waitFor(async () => expect((await providerField()).textContent).toContain('Z.ai'));
  });

  it('chooses «Not chosen» when several projects have different defaults', async () => {
    mount({ [APP]: registry(APP, 'anthropic'), [LIB]: registry(LIB, 'zai') });
    await text();
    await waitFor(async () => expect((await providerField()).textContent).toContain('Anthropic'));
    await addLib();
    await waitFor(async () => expect((await providerField()).textContent).toContain('Not chosen'));
  });

  it('keeps the default when several projects share it', async () => {
    mount({ [APP]: registry(APP, 'anthropic'), [LIB]: registry(LIB, 'anthropic') });
    await text();
    await addLib();
    await waitFor(async () => expect((await providerField()).textContent).toContain('Anthropic'));
  });
});
