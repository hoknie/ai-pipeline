// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { ApiError, type Api } from '../src/shared/api/api.ts';
import type { ConnectionView, ProjectLinkView } from '../src/shared/api/types.ts';

import {
  FakeSocket,
  fakeApi,
  integrationsOverview,
  openFake,
  projectLinkView,
  queueOf,
  repositoryView,
} from './fixtures.ts';

const APP = '/work/app';

const REGISTRY: ConnectionView = {
  id: 'c9',
  kind: 'service-registry',
  name: 'main',
  scope: 'global',
  project: null,
  params: { url: 'https://registry.example.com' },
  enabled: true,
  state: 'ready',
  secrets: [{ slot: 'token', required: true, present: true }],
  pending: false,
  lastCheck: null,
  channel: null,
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function open(
  overrides: Partial<Api> = {},
  connections: ConnectionView[] = [REGISTRY],
): Promise<Api> {
  window.location.hash = '#settings/global/projects/app';
  const api = fakeApi({
    queue: vi.fn(async () => queueOf({ repository: APP })),
    integrations: vi.fn(async () => integrationsOverview({ connections })),
    ...overrides,
  });
  render(<App api={api} openStream={openFake} />);
  await screen.findByRole('banner');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  act(() => {
    FakeSocket.last?.send({
      event: 'snapshot',
      seq: 1,
      runs: [],
      queues: [queueOf({ repository: APP })],
      repositories: [repositoryView(APP)],
    });
  });
  return api;
}

const registry = () => screen.findByRole('group', { name: 'Service registry' });

describe('the registry link in the settings of a project', () => {
  it('shows the status, the path, the source and the address of the card', async () => {
    await open({
      integrationLinks: vi.fn(async () => [projectLinkView('c9', APP)]),
    });
    const section = within(await registry());
    expect(section.getByText('acme/backend/api')).toBeTruthy();
    expect(section.getByText('by origin')).toBeTruthy();
    expect(section.getByText('Linked')).toBeTruthy();
    const link = section.getByRole('link', { name: /Open in the registry/ });
    expect(link.getAttribute('href')).toBe(
      'https://registry.example.com/catalog?node=acme%2Fbackend%2Fapi',
    );
  });

  it('shows why a project is not linked, with the candidates', async () => {
    await open({
      integrationLinks: vi.fn(async () => [
        projectLinkView('c9', APP, {
          registryPath: null,
          source: null,
          status: 'ambiguous',
          candidates: ['acme/a', 'acme/b'],
          url: null,
        }),
      ]),
    });
    const section = within(await registry());
    expect(section.getByText(/Several projects match.*acme\/a, acme\/b/)).toBeTruthy();
    expect(section.queryByRole('link')).toBeNull();
  });

  it('is not shown for a project without a registry connection', async () => {
    await open({}, []);
    await screen.findByRole('form', { name: 'project app' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(screen.queryByRole('group', { name: 'Service registry' })).toBeNull();
  });

  it('links the path typed by hand', async () => {
    const integrationLink = vi.fn(async (id: string, repository: string) =>
      projectLinkView(id, repository, { registryPath: 'acme/legacy/api', source: 'manual' }),
    );
    await open({ integrationLink });
    const section = within(await registry());
    fireEvent.change(section.getByLabelText('Registry project path'), {
      target: { value: ' acme/legacy/api ' },
    });
    fireEvent.click(section.getByRole('button', { name: 'Save path' }));
    await waitFor(() =>
      expect(integrationLink).toHaveBeenCalledWith('c9', APP, { path: 'acme/legacy/api' }),
    );
    expect(await section.findByText('manual')).toBeTruthy();
    expect(section.getByText('acme/legacy/api', { selector: 'code' })).toBeTruthy();
  });

  it('shows the refusal at the field and keeps the link', async () => {
    const integrationLink = vi.fn(async () => {
      throw new ApiError(400, 'project acme/none is not found in the service registry');
    });
    await open({
      integrationLink,
      integrationLinks: vi.fn(async () => [projectLinkView('c9', APP)]),
    });
    const section = within(await registry());
    fireEvent.change(section.getByLabelText('Registry project path'), {
      target: { value: 'acme/none' },
    });
    fireEvent.click(section.getByRole('button', { name: 'Save path' }));
    const alert = await section.findByRole('alert');
    expect(alert.textContent).toBe('project acme/none is not found in the service registry');
    expect(section.getByLabelText('Registry project path').getAttribute('aria-invalid')).toBe(
      'true',
    );
    // the link stays as it was
    expect(section.getByText('acme/backend/api', { selector: 'code' })).toBeTruthy();
    expect(section.getByText('Linked')).toBeTruthy();
  });

  it('resets the link and matches again', async () => {
    const answers: ProjectLinkView[] = [
      projectLinkView('c9', APP, {
        registryPath: null,
        source: null,
        status: 'disabled',
        url: null,
      }),
      projectLinkView('c9', APP),
    ];
    const integrationLink = vi.fn(async () => answers.shift()!);
    await open({
      integrationLink,
      integrationLinks: vi.fn(async () => [projectLinkView('c9', APP)]),
    });
    const section = within(await registry());
    fireEvent.click(section.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(integrationLink).toHaveBeenCalledWith('c9', APP, { clear: true }));
    expect(await section.findByText(/matching is off/)).toBeTruthy();
    expect(section.queryByRole('link')).toBeNull();
    fireEvent.click(section.getByRole('button', { name: 'Match again' }));
    await waitFor(() => expect(integrationLink).toHaveBeenCalledWith('c9', APP, { auto: true }));
    expect(await section.findByText('Linked')).toBeTruthy();
  });
});
