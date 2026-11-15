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
  it('has exactly one `g` row per section and unique combos', () => {
    for (const section of SECTIONS) {
      expect(SHORTCUTS.filter((item) => item.combo === `g ${section.key}`)).toHaveLength(1);
    }
    const combos = SHORTCUTS.map((item) => item.combo);
    expect(new Set(combos).size).toBe(combos.length);
  });
});

describe('panel hotkeys', () => {
  it('goes to the queue, the runs and the settings with g and a letter', async () => {
    mount();
    press('g', 'KeyG');
    press('q', 'KeyQ');
    await waitFor(() => expect(window.location.hash).toMatch(/^#queue/));
    press('g', 'KeyG');
    press('r', 'KeyR');
    await waitFor(() => expect(window.location.hash).toMatch(/^#runs/));
    press('g', 'KeyG');
    press('c', 'KeyC');
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/general'));
  });

  it('works in the Russian layout', async () => {
    mount();
    press('п', 'KeyG');
    press('й', 'KeyQ');
    await waitFor(() => expect(window.location.hash).toMatch(/^#queue/));
  });

  it('opens the new task dialog with n', async () => {
    mount();
    await waitFor(() =>
      expect(
        screen.getAllByRole<HTMLButtonElement>('button', { name: 'New task' })[0]!.disabled,
      ).toBe(false),
    );
    press('n', 'KeyN');
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    const text = within(dialog).getByLabelText('Task text') as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(text));
    expect(text.value).toBe('');
  });

  it('leaves Ctrl+R and Cmd+R to the browser', async () => {
    mount();
    press('g', 'KeyG');
    press('q', 'KeyQ');
    await waitFor(() => expect(window.location.hash).toMatch(/^#queue/));
    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      press('g', 'KeyG');
      const event = new KeyboardEvent('keydown', {
        key: 'r',
        code: 'KeyR',
        cancelable: true,
        bubbles: true,
        ...init,
      });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(window.location.hash).toMatch(/^#queue/);
    }
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
        .getAllByText(/^[gq]$/)
        .map((node) => node.textContent),
    ).toEqual(['g', 'q']);
  });
});
