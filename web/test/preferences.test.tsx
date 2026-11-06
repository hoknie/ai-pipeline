// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { usePreference } from '../src/preferences.ts';

import { FakeEventSource, fakeApi, groupView, openFake, runView } from './fixtures.ts';

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('preferences of the panel', () => {
  it('keeps a value between mounts', () => {
    const first = renderHook(() => usePreference('flag', false));
    act(() => first.result.current[1](true));
    first.unmount();
    const second = renderHook(() => usePreference('flag', false));
    expect(second.result.current[0]).toBe(true);
    expect(window.localStorage.getItem('aip.web.flag')).toBe('true');
  });

  it('works as plain state when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => usePreference('flag', false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});

describe('answers-only switch of the run screen', () => {
  const transcript = vi.fn(async () => ({
    runId: 'run1',
    group: 'login',
    seq: 1,
    cursor: 2,
    running: false,
    entries: [
      { kind: 'text' as const, text: 'ответ специалиста' },
      { kind: 'tool_call' as const, id: 't1', name: 'Read', summary: 'a.ts', input: '{}' },
    ],
  }));

  function open() {
    window.location.hash = '#runs/run1/login';
    const utils = render(
      <App
        api={fakeApi({ group: vi.fn(async () => groupView()), transcript })}
        openStream={openFake}
      />,
    );
    act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    return utils;
  }

  // The first render of the run screen in a file is several times slower than the next ones; it is
  // paid here and not by the first test.
  beforeAll(() => {
    open().unmount();
    window.location.hash = '';
  });

  it('filters the logs', async () => {
    open();
    await screen.findByText('Read');
    const toggle = screen.getByRole('switch', { name: 'Specialist replies' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.queryByText('Read')).toBeNull();
    expect(screen.getByText('ответ специалиста')).toBeTruthy();
  });

  it('keeps the filter on after the panel is opened again', async () => {
    const first = open();
    await screen.findByText('Read');
    fireEvent.click(screen.getByRole('switch', { name: 'Specialist replies' }));
    first.unmount();
    open();
    await screen.findByText('ответ специалиста');
    expect(
      screen.getByRole('switch', { name: 'Specialist replies' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.queryByText('Read')).toBeNull();
  });

  it('has no JSON switch', async () => {
    open();
    await screen.findByText('Read');
    expect(screen.queryByRole('switch', { name: /JSON/ })).toBeNull();
  });
});
