// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  notificationItems,
  pruneKeys,
  readPermission,
  useNotificationCenter,
} from '../src/app/notifications.ts';

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
  it('drops the mark of a group that left its state in the loaded run', () => {
    const runs = [
      runView({ groups: [failed('a'), groupRow({ slug: 'gone', status: 'running' })] }),
    ];
    expect(pruneKeys(['run1/a/failed', 'run1/gone/failed'], runs)).toEqual(['run1/a/failed']);
  });

  it('keeps the mark of a run that is not loaded', () => {
    const runs = [runView({ groups: [failed('a')] })];
    expect(pruneKeys(['old/a/failed', 'run1/a/failed'], runs)).toEqual([
      'old/a/failed',
      'run1/a/failed',
    ]);
    expect(pruneKeys(['old/a/failed'], [])).toEqual(['old/a/failed']);
  });

  it('keeps the mark of a run the observer repairs', () => {
    const repairing = {
      ...runView({ groups: [failed('a')] }),
      repair: { allowed: true, active: true, repairs: 1, incident: null },
    } as ReturnType<typeof runView>;
    expect(notificationItems([repairing])).toEqual([]);
    expect(pruneKeys(['run1/a/failed'], [repairing])).toEqual(['run1/a/failed']);
  });

  it('keeps at most 1000 marks, dropping the oldest', () => {
    const keys = Array.from({ length: 1005 }, (_, index) => `old${index}/a/failed`);
    const kept = pruneKeys(keys, []);
    expect(kept).toHaveLength(1000);
    expect(kept[0]).toBe('old5/a/failed');
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

  it('keeps a hidden and a read mark while the run is not loaded, and after it returns', () => {
    const marked = [runView({ id: 'old', groups: [failed('f')] })];
    const first = mount(marked);
    act(() => first.result.current.open());
    act(() => first.result.current.hide('old/f/failed'));
    first.unmount();
    // after a reload the snapshot has no such run
    const second = mount([runView({ id: 'new', groups: [] })]);
    expect(window.localStorage.getItem('aip.web.notificationsHidden')).toBe('["old/f/failed"]');
    expect(window.localStorage.getItem('aip.web.notificationsRead')).toBe('["old/f/failed"]');
    second.rerender({ runs: [runView({ id: 'new', groups: [] }), ...marked] });
    expect(second.result.current.items).toEqual([]);
    expect(second.result.current.unread).toBe(0);
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

    it('stays silent about a run loaded after the first state', () => {
      const live = [runView({ id: 'live', groups: [groupRow({ slug: 'f' })] })];
      const { rerender } = renderHook(
        ({ runs, listed }) => useNotificationCenter(runs, open, true, listed),
        { initialProps: { runs: live, listed: new Set(['live']) as ReadonlySet<string> } },
      );
      const history = runView({ id: 'old', groups: [failed('f')] });
      rerender({ runs: [...live, history], listed: new Set(['live']) });
      expect(FakeNotification.created).toEqual([]);
      // the run enters the live list with the same state: its key is known, so still silent
      rerender({ runs: [...live, history], listed: new Set(['live', 'old']) });
      expect(FakeNotification.created).toEqual([]);
      // a new failure of a listed run is announced once
      const fell = runView({ id: 'live', groups: [failed('f')] });
      rerender({ runs: [fell, history], listed: new Set(['live', 'old']) });
      expect(FakeNotification.created).toHaveLength(1);
      expect(FakeNotification.created[0]!.options.tag).toBe('live/f/failed');
    });

    it('announces a loaded run once when it fails again', () => {
      const live = [runView({ id: 'live', groups: [groupRow({ slug: 'f' })] })];
      const listed = new Set(['live', 'old']) as ReadonlySet<string>;
      const { rerender } = renderHook(
        ({ runs, listed }) => useNotificationCenter(runs, open, true, listed),
        { initialProps: { runs: live, listed: new Set(['live']) as ReadonlySet<string> } },
      );
      const failedOld = runView({ id: 'old', groups: [failed('f')] });
      rerender({ runs: [...live, failedOld], listed: new Set(['live']) });
      expect(FakeNotification.created).toEqual([]);
      const rerun = runView({ id: 'old', groups: [groupRow({ slug: 'f', status: 'running' })] });
      rerender({ runs: [...live, rerun], listed });
      expect(FakeNotification.created).toEqual([]);
      rerender({ runs: [...live, runView({ id: 'old', groups: [failed('f')] })], listed });
      expect(FakeNotification.created).toHaveLength(1);
      expect(FakeNotification.created[0]!.options.tag).toBe('old/f/failed');
    });

    it('stays silent about a hidden item after a repair ends', () => {
      const group = failed('f');
      const { result, rerender } = renderHook(
        ({ runs }) => useNotificationCenter(runs, open, true),
        { initialProps: { runs: [runView({ groups: [group] })] } },
      );
      act(() => result.current.hide('run1/f/failed'));
      const base = runView({ groups: [group] });
      const repairing = {
        ...base,
        repair: { allowed: true, active: true, repairs: 1, incident: null },
      } as unknown as ReturnType<typeof runView>;
      rerender({ runs: [repairing] });
      const finished = {
        ...repairing,
        repair: { ...repairing.repair, active: false },
      } as ReturnType<typeof runView>;
      rerender({ runs: [finished] });
      expect(FakeNotification.created).toEqual([]);
      expect(result.current.items).toEqual([]);
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
