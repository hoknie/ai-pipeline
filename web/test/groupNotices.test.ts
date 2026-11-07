// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DISMISSED_LIMIT,
  groupNotices,
  latestNotice,
  useDismissedNotice,
} from '../src/features/runs/group/groupNotices.ts';

import { groupRow, groupView } from './fixtures.ts';

const outside = (seq: number, files: string[]) => ({
  ...groupView().attempts[0]!,
  seq,
  outsideChanges: files,
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('notices of a group', () => {
  it('orders warnings, attempt blocks, the hint and the reason', () => {
    const view = groupView({
      warnings: ['a', 'b'],
      permissionHints: ['x *'],
      attempts: [outside(2, ['f']), outside(1, ['g']), outside(3, [])],
    });
    const notices = groupNotices(view, groupRow({ status: 'failed', reason: 'boom' }));
    expect(notices.map((notice) => notice.key)).toEqual([
      'warning:0:a',
      'warning:1:b',
      'outside:1',
      'outside:2',
      'hints:x *',
      'reason:boom',
    ]);
  });

  it('picks the last one and does not raise an older one after it is closed', () => {
    const notices = groupNotices(groupView({ warnings: ['a', 'b'] }), groupRow());
    expect(latestNotice(notices, null)?.key).toBe('warning:1:b');
    expect(latestNotice(notices, 'warning:1:b')).toBeNull();
    expect(latestNotice(notices, 'warning:0:a')?.key).toBe('warning:1:b');
  });

  it('tells apart a repeated warning line', () => {
    const notices = groupNotices(groupView({ warnings: ['same', 'same'] }), groupRow());
    expect(notices.map((notice) => notice.key)).toEqual(['warning:0:same', 'warning:1:same']);
  });

  it('leaves out the reason of a group waiting for an answer and works without a view', () => {
    expect(groupNotices(null, groupRow({ status: 'needs_human', reason: 'boom' }))).toEqual([]);
    expect(
      groupNotices(null, groupRow({ status: 'failed', reason: 'boom' })).map((n) => n.key),
    ).toEqual(['reason:boom']);
  });
});

describe('closed notice', () => {
  it('is kept in localStorage and read after a new mount', () => {
    const first = renderHook(() => useDismissedNotice('run1', 'login'));
    act(() => first.result.current[1]('reason:boom'));
    expect(JSON.parse(window.localStorage.getItem('aip.web.dismissedNotices')!)).toEqual({
      'run1/login': 'reason:boom',
    });
    first.unmount();
    const second = renderHook(() => useDismissedNotice('run1', 'login'));
    expect(second.result.current[0]).toBe('reason:boom');
    expect(renderHook(() => useDismissedNotice('run1', 'other')).result.current[0]).toBeNull();
  });

  it('keeps no more than the last 200 groups', () => {
    const hook = renderHook(() => useDismissedNotice('run1', 'g'));
    for (let index = 0; index < DISMISSED_LIMIT + 5; index++) {
      const each = renderHook(() => useDismissedNotice('run1', `g${index}`));
      act(() => each.result.current[1](`k${index}`));
      each.unmount();
    }
    hook.unmount();
    const stored = JSON.parse(window.localStorage.getItem('aip.web.dismissedNotices')!);
    expect(Object.keys(stored)).toHaveLength(DISMISSED_LIMIT);
    expect(stored['run1/g0']).toBeUndefined();
    expect(stored[`run1/g${DISMISSED_LIMIT + 4}`]).toBe(`k${DISMISSED_LIMIT + 4}`);
  });
});
