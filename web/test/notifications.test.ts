// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  notificationItems,
  pruneKeys,
  readPermission,
  useNotificationCenter,
} from '../src/notifications.ts';

import { groupRow, runView } from './fixtures.ts';

class FakeNotification {
  static permission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static created: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options: { body?: string; tag?: string },
  ) {
    FakeNotification.created.push(this);
  }
}

function stub(permission: string): void {
  FakeNotification.permission = permission;
  FakeNotification.created = [];
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
}

beforeEach(() => {
  window.localStorage.clear();
  stub('granted');
});
afterEach(() => vi.unstubAllGlobals());

const failed = (slug = 'a', extra = {}) =>
  groupRow({ slug, title: slug, status: 'failed', reason: 'boom\nsecond line', ...extra });
const asking = (slug = 'q') =>
  groupRow({ slug, title: slug, status: 'needs_human', question: '\nWhich one?\nmore' });

describe('notificationItems', () => {
  it('carries the human-only mark of a question', () => {
    const items = notificationItems([
      runView({
        groups: [
          groupRow({ slug: 'a', status: 'needs_human', question: 'Look?', humanOnly: 'review' }),
          groupRow({ slug: 'b', status: 'needs_human', question: 'Plain?' }),
          groupRow({ slug: 'c', status: 'failed', reason: 'boom', humanOnly: 'request' }),
        ],
      }),
    ]);
    expect(items.map((item) => [item.slug, item.humanOnly])).toEqual([
      ['a', 'review'],
      ['b', null],
      ['c', null],
    ]);
  });

  it('takes needs_human, failed, conflict and apply_failed groups of every repository', () => {
    const items = notificationItems([
      runView({
        id: 'r1',
        repository: '/a',
        groups: [
          groupRow({ slug: 'ok', status: 'running' }),
          failed('f'),
          groupRow({ slug: 'c', status: 'conflict', reason: 'merge' }),
          groupRow({ slug: 'd', status: 'merged', delivery: 'apply_failed', reason: 'patch' }),
          groupRow({ slug: 'x', status: 'cancelled' }),
        ],
      }),
      runView({ id: 'r2', repository: '/b', groups: [asking()] }),
    ]);
    expect(items.map((item) => item.key)).toEqual([
      'r2/q/needs_human',
      'r1/f/failed',
      'r1/c/conflict',
      'r1/d/apply_failed',
    ]);
    expect(items[0]).toMatchObject({
      repository: '/b',
      detail: 'Which one?',
      runTitle: 'добавить вход',
    });
    expect(items[1]!.detail).toBe('boom');
  });

  it('orders by kind, then newest run first, then the order of groups', () => {
    const items = notificationItems([
      runView({ id: 'old', createdAt: 1, groups: [failed('b'), failed('a')] }),
      runView({ id: 'new', createdAt: 5, groups: [failed('c')] }),
    ]);
    expect(items.map((item) => item.key)).toEqual(['new/c/failed', 'old/b/failed', 'old/a/failed']);
  });

  it('names a run without a title by its id and has an empty detail without a reason', () => {
    const [item] = notificationItems([
      runView({ id: 'r9', title: '', name: null, groups: [failed('a', { reason: null })] }),
    ]);
    expect(item!.runTitle).toBe('r9');
    expect(item!.detail).toBe('');
  });

  it('is empty for runs that need nobody', () => {
    expect(notificationItems([runView()])).toEqual([]);
  });
});

describe('pruneKeys', () => {
  it('keeps only the keys of current items', () => {
    const items = notificationItems([runView({ groups: [failed('a')] })]);
    expect(pruneKeys(['run1/a/failed', 'run1/gone/failed'], items)).toEqual(['run1/a/failed']);
  });
});

describe('readPermission', () => {
  it.each(['default', 'granted', 'denied'])('reads %s', (permission) => {
    stub(permission);
    expect(readPermission()).toBe(permission);
  });

  it('is unsupported without Notification', () => {
    vi.stubGlobal('Notification', undefined);
    expect(readPermission()).toBe('unsupported');
  });

  it('is unsupported outside a secure context', () => {
    vi.spyOn(window, 'isSecureContext', 'get').mockReturnValue(false);
    expect(readPermission()).toBe('unsupported');
    vi.restoreAllMocks();
  });
});

describe('useNotificationCenter', () => {
  const open = vi.fn();
  const mount = (runs = [runView({ groups: [asking(), failed('f')] })], ready = true) =>
    renderHook(({ runs: current }) => useNotificationCenter(current, open, ready), {
      initialProps: { runs },
    });

  it('counts unread, warns while a question is unread, and marks all read on open', () => {
    const { result } = mount();
    expect(result.current.unread).toBe(2);
    expect(result.current.unreadTone).toBe('warn');
    act(() => result.current.open());
    expect(result.current.unread).toBe(0);
    expect(result.current.unreadTone).toBe('err');
  });

  it('remembers read marks over a reload', () => {
    const first = mount();
    act(() => first.result.current.open());
    first.unmount();
    expect(mount().result.current.unread).toBe(0);
  });

  it('does not wipe the marks before the first state of the runs arrived', () => {
    const first = mount();
    act(() => first.result.current.open());
    first.unmount();
    const second = mount([], false);
    second.rerender({ runs: [runView({ groups: [asking(), failed('f')] })] });
    expect(second.result.current.unread).toBe(0);
  });

  it('brings a hidden item back after the group left the state and fell again', () => {
    const { result, rerender } = mount([runView({ groups: [failed('f')] })]);
    act(() => result.current.hide('run1/f/failed'));
    expect(result.current.items).toHaveLength(0);
    rerender({ runs: [runView({ groups: [groupRow({ slug: 'f', status: 'running' })] })] });
    rerender({ runs: [runView({ groups: [failed('f')] })] });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.unread).toBe(1);
  });

  it('hides everything at once', () => {
    const { result } = mount();
    act(() => result.current.hideAll());
    expect(result.current.items).toEqual([]);
    expect(result.current.unread).toBe(0);
  });

  it('reads the permission again on open and asks for it on enable', async () => {
    stub('default');
    const { result } = mount();
    expect(result.current.permission).toBe('default');
    FakeNotification.permission = 'denied';
    act(() => result.current.open());
    expect(result.current.permission).toBe('denied');
    stub('default');
    FakeNotification.requestPermission.mockImplementation(async () => {
      FakeNotification.permission = 'granted';
      return 'granted';
    });
    act(() => result.current.open());
    await act(async () => result.current.enable());
    expect(result.current.permission).toBe('granted');
  });

  it('selects an item through the callback', () => {
    const { result } = mount();
    act(() => result.current.select(result.current.items[0]!));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ slug: 'q' }));
  });

  describe('system notifications', () => {
    it('stays silent about what was there at the first state', () => {
      mount();
      expect(FakeNotification.created).toEqual([]);
    });

    it('waits for the first real state before taking the baseline', () => {
      const { rerender } = mount([], false);
      rerender({ runs: [runView({ groups: [failed('f')] })] });
      expect(FakeNotification.created).toEqual([]);
    });

    it('shows one notification per transition, tagged by the item', () => {
      const { rerender } = mount([runView({ groups: [groupRow({ slug: 'f' })] })]);
      const next = [runView({ groups: [failed('f')] })];
      rerender({ runs: next });
      rerender({ runs: [...next] });
      expect(FakeNotification.created).toHaveLength(1);
      expect(FakeNotification.created[0]).toMatchObject({
        title: 'aip: f',
        options: { body: 'Failed · boom', tag: 'run1/f/failed' },
      });
    });

    it('shows nothing without the permission', () => {
      stub('denied');
      const { rerender } = mount([runView({ groups: [groupRow({ slug: 'f' })] })]);
      rerender({ runs: [runView({ groups: [failed('f')] })] });
      expect(FakeNotification.created).toEqual([]);
    });

    it('opens the group on click, focuses the window and closes the notification', () => {
      const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
      const { rerender } = mount([runView({ groups: [groupRow({ slug: 'f' })] })]);
      rerender({ runs: [runView({ groups: [failed('f')] })] });
      const created = FakeNotification.created[0]!;
      created.onclick!();
      expect(focus).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run1', slug: 'f' }));
      expect(created.close).toHaveBeenCalled();
    });
  });
});
