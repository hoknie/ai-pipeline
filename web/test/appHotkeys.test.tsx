// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { SECTIONS } from '../src/app/sections.ts';
import { SHORTCUTS } from '../src/app/shortcuts.ts';

import { FakeEventSource, configView, fakeApi, groupView, openFake, queueOf } from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

beforeEach(() => {
  window.location.hash = '#runs';
  window.localStorage.clear();
});
afterEach(() => cleanup());

function mount() {
  const api = fakeApi({
    group: vi.fn(async () => groupView()),
    config: vi.fn(async () => configView()),
    queue: vi.fn(async () => queueOf()),
  });
  render(<App api={api} openStream={openFake} />);
  act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs: [] }));
  return api;
}

const press = (key: string, code: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.body, { key, code, ...init });

describe('shortcut list', () => {
  it('has exactly one ctrl row per section and unique combos', () => {
    for (const section of SECTIONS) {
      expect(SHORTCUTS.filter((item) => item.combo === `ctrl+${section.key}`)).toHaveLength(1);
    }
    const combos = SHORTCUTS.map((item) => item.combo);
    expect(new Set(combos).size).toBe(combos.length);
  });
});

describe('panel hotkeys', () => {
  it('goes to the queue, the runs and the settings with ctrl and a letter', async () => {
    mount();
    press('q', 'KeyQ', { ctrlKey: true });
    await waitFor(() => expect(window.location.hash).toMatch(/^#queue/));
    press('r', 'KeyR', { ctrlKey: true });
    await waitFor(() => expect(window.location.hash).toMatch(/^#runs/));
    press('c', 'KeyC', { ctrlKey: true });
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/general'));
  });

  it('ctrl+b goes to the pipelines and ctrl+t to the stats', async () => {
    mount();
    press('b', 'KeyB', { ctrlKey: true });
    await waitFor(() => expect(window.location.hash).toMatch(/^#pipelines/));
    press('t', 'KeyT', { ctrlKey: true });
    await waitFor(() => expect(window.location.hash).toMatch(/^#stats/));
  });

  it('works in the Russian layout', async () => {
    mount();
    press('й', 'KeyQ', { ctrlKey: true });
    await waitFor(() => expect(window.location.hash).toMatch(/^#queue/));
  });

  it('opens the new task dialog with ctrl+n', async () => {
    mount();
    await waitFor(() =>
      expect(
        screen.getAllByRole<HTMLButtonElement>('button', { name: 'New task' })[0]!.disabled,
      ).toBe(false),
    );
    press('n', 'KeyN', { ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    const text = within(dialog).getByLabelText('Task text') as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(text));
    expect(text.value).toBe('');
  });

  it('takes ctrl+r for itself and leaves cmd+r to the browser', async () => {
    mount();
    press('q', 'KeyQ', { ctrlKey: true });
    await waitFor(() => expect(window.location.hash).toMatch(/^#queue/));
    press('r', 'KeyR', { ctrlKey: true });
    await waitFor(() => expect(window.location.hash).toMatch(/^#runs/));
    const event = new KeyboardEvent('keydown', {
      key: 'r',
      code: 'KeyR',
      cancelable: true,
      bubbles: true,
      metaKey: true,
    });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.location.hash).toMatch(/^#runs/);
  });

  it('shows the reference by groups with ?', async () => {
    mount();
    press('?', 'Slash', { shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const group of ['General', 'Navigation', 'Runs', 'Queue']) {
      expect(within(dialog).getByRole('heading', { name: group })).toBeTruthy();
    }
    const navigation = within(dialog).getByRole('region', { name: 'Navigation' });
    const row = within(navigation).getByText('Queue').closest('div')!;
    expect(
      within(row)
        .getAllByText(/^(Ctrl|Q)$/)
        .map((node) => node.textContent),
    ).toEqual(['Ctrl', 'Q']);
  });
});
