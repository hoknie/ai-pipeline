import { describe, expect, test } from 'claude-code/testing';

import {
  groupLine,
  needsYou,
  orderGroups,
  paneGroupActions,
  panelView,
  runHeader,
  runRow,
  runState,
} from '../hooks/pane.ts';
import { runActions } from '../hooks/feed.ts';
import { group, legacyRun, run } from './fixtures.ts';

const FULL = { compact: false, now: 3_600_000 };
const COMPACT = { compact: true, now: 3_600_000 };
const LIVE = { mode: 'stream', error: null } as const;

describe('pane', () => {
  test('orderGroups lifts urgent groups and keeps the order inside a level', () => {
    const ordered = orderGroups([
      group('a', { status: 'merged' }),
      group('b', { status: 'running' }),
      group('c', { status: 'failed' }),
      group('d', { status: 'running' }),
      group('e', { status: 'needs_human' }),
      group('f', { status: 'queued' }),
    ]);
    expect(ordered.map((one) => one.slug)).toEqual(['e', 'c', 'b', 'd', 'f', 'a']);
  });

  test('actions per group status', () => {
    const two = (status: Parameters<typeof group>[1] & object) => {
      const target = group('a', status);
      return paneGroupActions(run('r1', [target, group('b')]), target);
    };
    expect(two({ status: 'queued' })).toEqual(['cancel']);
    expect(two({ status: 'running' })).toEqual(['cancel']);
    expect(two({ status: 'failed' })).toEqual(['retry']);
    expect(two({ status: 'conflict' })).toEqual(['retry', 'cancel']);
    expect(two({ status: 'merged', delivery: 'pending' })).toEqual(['apply']);
    expect(two({ status: 'merged', delivery: 'applied' })).toEqual([]);
    expect(two({ status: 'cancelled' })).toEqual([]);
    expect(two({ status: 'needs_human' })).toEqual(['cancel']);
  });

  test('a run of one group has run actions only', () => {
    const only = group('login');
    const single = run('r1', [only]);
    expect(paneGroupActions(single, only)).toEqual([]);
    expect(runActions(single)).toContain('cancel');
    const failed = group('login', { status: 'failed' });
    expect(paneGroupActions(run('r1', [failed]), failed)).toEqual(['retry']);
  });

  test('needsYou opens the questions of the selected run only', () => {
    const asking = group('login', { status: 'needs_human', question: 'Auth?' });
    const runs = [
      run('r1', [asking], { createdAt: 1 }),
      run('r2', [group('x', { status: 'needs_human', question: 'Where?' })], { createdAt: 2 }),
    ];
    const selected = needsYou(runs, 'r1');
    expect(selected.open.map((item) => `${item.runId}/${item.slug}`)).toEqual(['r1/login']);
    expect(selected.rows.map((item) => `${item.runId}/${item.slug}`)).toEqual(['r2/x']);
    const other = needsYou(runs, 'r2');
    expect(other.open.map((item) => item.slug)).toEqual(['x']);
    expect(other.rows.map((item) => item.slug)).toEqual(['login']);
  });

  test('needsYou lists a failed delivery and folds rows over five', () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      group(`g${index}`, { status: 'failed', reason: 'boom' }),
    );
    const result = needsYou([run('r1', rows)], null);
    expect(result.rows).toHaveLength(5);
    expect(result.more).toBe(2);
    const delivery = needsYou(
      [run('r1', [group('m', { status: 'merged', delivery: 'apply_failed' })])],
      'r1',
    );
    expect(delivery.rows.map((item) => item.slug)).toEqual(['m']);
    expect(delivery.open).toEqual([]);
  });

  test('the compact row and header drop the bar, the age and the money', () => {
    const one = run('r1', [group('a', { status: 'merged' })], { title: 'Add login' });
    const row = runRow(one, true, 0, COMPACT);
    expect(row).toMatchObject({ marker: '›', hotkey: '1', bar: null, age: null, cost: null });
    expect(runRow(one, false, 1, FULL)).toMatchObject({ marker: null, hotkey: '2' });
    expect(runRow(one, false, 0, FULL).bar).toBe('▰▰▰▰▰▰▰▰▰▰');
    const meta = runHeader(one, COMPACT).meta;
    expect(meta).toBe('r1 · feature · active');
    const full = runHeader(one, FULL).meta;
    expect(full).toContain('$0.0123');
    expect(full).not.toContain('1200 in');
  });

  test('the header phase of a failed run is failed, without state it follows finished', () => {
    const failed = run('r1', [group('a', { status: 'failed' })], {
      finished: true,
      state: 'failed',
    });
    expect(runHeader(failed, COMPACT).meta).toBe('r1 · feature · failed');
    const legacy = run('r1', [group('a', { status: 'merged' })], { finished: true });
    expect(runHeader(legacy, COMPACT).meta).toBe('r1 · feature · finished');
  });

  test('a compact group is one line, the reason keeps its first line', () => {
    const failed = group('login', { status: 'failed', reason: 'boom\nstack\ntrace' });
    const owner = run('r1', [failed, group('b')]);
    const compact = groupLine(owner, failed, COMPACT);
    expect(compact.line).toBe('✕ login · code · r1 · 1m05s');
    expect(compact.details).toBeNull();
    expect(compact.reason).toBe('boom');
    const full = groupLine(owner, failed, FULL);
    expect(full.line).toBe('✕ failed · login');
    expect(full.details).toBe('step code · round 1 · 1m05s');
  });

  test('runState follows the most urgent group', () => {
    expect(runState(run('r1', [group('a'), group('b', { status: 'needs_human' })]))).toBe(
      'needs_human',
    );
    expect(runState(run('r1', [group('a', { status: 'queued' })]))).toBe('queued');
    const merged = run('r1', [group('a', { status: 'merged' })], { finished: true });
    expect(runState(merged)).toBe('merged');
    const cancelled = run('r1', [group('a', { status: 'cancelled' })], { finished: true });
    expect(runState(cancelled)).toBe('cancelled');
    const broken = run('r1', [group('a', { status: 'failed' })], { finished: true });
    expect(runState(broken)).toBe('failed');
  });

  test('panelView of no runs and of a run without the new fields', () => {
    const input = { runs: [], selected: null, connection: LIVE, action: null };
    const empty = panelView(input, FULL);
    expect(empty).toMatchObject({ empty: true, run: null, runs: [], note: null, result: null });
    expect(empty.header.summary).toBe('aip');
    const offline = panelView({ ...input, connection: { mode: 'missing', error: 'no aip' } }, FULL);
    expect(offline.empty).toBe(false);
    expect(offline.note).toEqual({ text: 'aip: no aip', color: 'error' });
    const old = panelView({ ...input, runs: [legacyRun('r1')] }, FULL);
    expect(old.run?.groups).toHaveLength(1);
    expect(old.header.summary).toBe('aip · 1 active');
    expect(old.runs[0]?.marker).toBe('›');
  });

  test('panelView keeps the result of an action as a theme line', () => {
    const view = panelView(
      {
        runs: [],
        selected: null,
        connection: LIVE,
        action: { id: 1, text: 'boom', isError: true },
      },
      FULL,
    );
    expect(view.result).toEqual({ icon: '✕', text: 'boom', color: 'error' });
  });
});
