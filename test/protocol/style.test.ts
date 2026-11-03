import { describe, expect, it } from 'vitest';

import {
  STATUS_BADGES,
  colorEnabled,
  createStyle,
  plainStyle,
  statusBadge,
  visibleWidth,
} from '../../src/protocol/index.ts';

const base = { noColorFlag: false, env: {}, isTTY: false };

describe('colorEnabled', () => {
  it('follows the terminal by default', () => {
    expect(colorEnabled({ ...base, isTTY: true })).toBe(true);
    expect(colorEnabled(base)).toBe(false);
  });

  it('never colors for TERM=dumb', () => {
    expect(colorEnabled({ ...base, isTTY: true, env: { TERM: 'dumb' } })).toBe(false);
  });

  it('turns colors on with FORCE_COLOR even without a terminal', () => {
    expect(colorEnabled({ ...base, env: { FORCE_COLOR: '1' } })).toBe(true);
  });

  it('turns colors off with FORCE_COLOR=0 or false', () => {
    expect(colorEnabled({ ...base, isTTY: true, env: { FORCE_COLOR: '0' } })).toBe(false);
    expect(colorEnabled({ ...base, isTTY: true, env: { FORCE_COLOR: 'false' } })).toBe(false);
  });

  it('prefers NO_COLOR over FORCE_COLOR', () => {
    expect(colorEnabled({ ...base, env: { NO_COLOR: '1', FORCE_COLOR: '1' } })).toBe(false);
  });

  it('prefers --no-color over everything', () => {
    expect(colorEnabled({ noColorFlag: true, isTTY: true, env: { FORCE_COLOR: '1' } })).toBe(false);
  });
});

describe('styles', () => {
  it('returns text unchanged when colors are off', () => {
    for (const style of [plainStyle, createStyle(false)]) {
      for (const role of Object.values(style)) expect(role('text')).toBe('text');
    }
  });

  it('wraps text in ANSI codes when colors are on', () => {
    const style = createStyle(true);
    for (const role of Object.values(style)) {
      const painted = role('text');
      expect(painted).toContain('\x1b[');
      expect(painted).toContain('text');
    }
  });
});

describe('statusBadge', () => {
  const style = createStyle(true);
  const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
  const table: [string[], string, string][] = [
    [['merged', 'finished', 'applied', 'done'], '✓', '\x1b[32m'],
    [['failed', 'conflict', 'apply_failed', 'rejected'], '✗', '\x1b[31m'],
    [['needs_human'], '?', '\x1b[33m'],
    [['running', 'active', 'merging'], '▸', '\x1b[36m'],
    [['queued', 'pending', 'stopped'], '◦', '\x1b[2m'],
    [['cancelled'], '⊘', '\x1b[2m'],
  ];

  it('puts a colored badge before every state', () => {
    for (const [states, badge, code] of table) {
      for (const state of states) {
        const text = statusBadge(state, style);
        expect(plain(text)).toBe(`${badge} ${state}`);
        expect(text.startsWith(code), state).toBe(true);
      }
    }
  });

  it('leaves an unknown state and the plain style unchanged', () => {
    expect(statusBadge('whatever', style)).toBe('whatever');
    expect(statusBadge('toString', style)).toBe('toString');
    for (const state of Object.keys(STATUS_BADGES)) {
      expect(statusBadge(state, plainStyle)).toBe(state);
    }
  });

  it('uses one-column badges from the approved set', () => {
    for (const { badge } of Object.values(STATUS_BADGES)) {
      expect([...badge]).toHaveLength(1);
      expect('✓✗?▸◦◷⊘').toContain(badge);
    }
  });
});

describe('visibleWidth', () => {
  it('ignores SGR sequences', () => {
    expect(visibleWidth('abc')).toBe(3);
    expect(visibleWidth(createStyle(true).danger('✗ failed'))).toBe(8);
    expect(visibleWidth('')).toBe(0);
  });
});
