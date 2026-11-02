// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';

import {
  FakeEventSource,
  configView,
  fakeApi,
  groupRow,
  groupView,
  openFake,
  runView,
} from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});
afterEach(() => cleanup());

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const openPalette = () => fireEvent.keyDown(window, { key: 'k', metaKey: isMac, ctrlKey: !isMac });

function mount(runs = [runView()], extra: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({
    group: vi.fn(async () => groupView()),
    config: vi.fn(async () => configView()),
    ...extra,
  });
  render(<App api={api} openStream={openFake} />);
  act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs }));
  return api;
}

describe('workflow badge in the palette', () => {
  it('shows the badge on a run item', async () => {
    mount([runView({ id: 'a', title: 'First run', workflow: 'feature' })]);
    openPalette();
    const badge = (await screen.findAllByLabelText('Workflow: feature')).find((node) =>
      node.closest('[cmdk-item]'),
    )!;
    expect(badge.closest('[cmdk-item]')).toBeTruthy();
    expect(badge.hasAttribute('tabindex')).toBe(false);
  });
});

describe('command palette', () => {
  it('opens a run chosen from the palette', async () => {
    mount([runView({ id: 'a', title: 'First run' }), runView({ id: 'b', title: 'Second run' })]);
    openPalette();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText('Second run'));
    await waitFor(() => expect(window.location.hash).toBe('#runs/b'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('puts the runs waiting for an answer first', async () => {
    mount([
      runView({ id: 'a', title: 'Ordinary', createdAt: 9 }),
      runView({ id: 'w', title: 'Waiting', state: 'needs_human', waiting: 1, createdAt: 1 }),
    ]);
    openPalette();
    const dialog = await screen.findByRole('dialog');
    const group = dialog.querySelector('[cmdk-group-heading=""]')
      ? (within(dialog)
          .getAllByText('Runs')
          .find((node) => node.hasAttribute('cmdk-group-heading'))!
          .closest('[cmdk-group]') as HTMLElement)
      : dialog;
    const titles = within(group)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(titles[0]).toContain('Waiting');
    expect(titles[1]).toContain('Ordinary');
  });

  it('starts a new task in the queue from the palette', async () => {
    mount();
    openPalette();
    fireEvent.click(await screen.findByText('New task in the queue'));
    await waitFor(() => expect(window.location.hash).toBe('#queue'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Task text')));
  });

  it('closes on Esc', async () => {
    mount();
    openPalette();
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('loads workflows and specialists once, when the palette is first opened', async () => {
    const api = mount([runView()], {
      config: vi.fn(async () =>
        configView({
          workflows: [
            {
              id: 'feature',
              level: 'project',
              file: '/f',
              revision: 'r',
              raw: {},
              sources: { project: { file: '/f', revision: 'r', raw: {} } },
            },
          ],
        }),
      ),
    });
    expect(api.config).not.toHaveBeenCalled();
    openPalette();
    await waitFor(() => expect(api.config).toHaveBeenCalled());
    expect(
      await within(screen.getByRole('dialog')).findByRole('option', { name: 'feature' }),
    ).toBeTruthy();
    await waitFor(() => expect(api.config).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: 'Escape' });
    openPalette();
    expect(api.config).toHaveBeenCalledTimes(1);
  });

  it('opens the shortcuts with «?»', async () => {
    mount();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(await screen.findByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});

describe('section counters', () => {
  it('counts the runs waiting for an answer from the live events', async () => {
    mount([runView({ id: 'a', state: 'needs_human', waiting: 2 })]);
    expect(screen.getAllByLabelText('running: 1, waiting for an answer: 1').length).toBeGreaterThan(
      0,
    );
    expect(screen.getByLabelText('waiting for an answer: 1')).toBeTruthy();
    act(() =>
      FakeEventSource.last!.send({
        event: 'run',
        seq: 2,
        run: runView({ id: 'a', state: 'active', waiting: 0 }),
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText(/waiting for an answer/)).toBeNull());
    expect(screen.getAllByLabelText('running: 1').length).toBeGreaterThan(0);
    act(() =>
      FakeEventSource.last!.send({
        event: 'run',
        seq: 3,
        run: runView({ id: 'a', state: 'finished', finished: true }),
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText(/^running: /)).toBeNull());
  });

  it('ignores the navigation collapsed by an older version', () => {
    window.localStorage.setItem('aip.web.navCollapsed', 'true');
    mount();
    expect(screen.queryByRole('button', { name: /navigation/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Runs/ })).toBeTruthy();
  });

  it('shows the reconnection and the return of the link', () => {
    mount();
    act(() => FakeEventSource.last!.open());
    expect(screen.getByRole('status', { name: 'link with the daemon: Connected' })).toBeTruthy();
    act(() => FakeEventSource.last!.fail());
    expect(screen.getByRole('status', { name: 'link with the daemon: Reconnecting' })).toBeTruthy();
    act(() => FakeEventSource.last!.open());
    expect(screen.getByRole('status', { name: 'link with the daemon: Connected' })).toBeTruthy();
  });
});

void groupRow;
