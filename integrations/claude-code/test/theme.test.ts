import { describe, expect, test } from 'claude-code/testing';

import { CONNECTION, DELIVERY, RESULT, STATUS, THEME_KEYS, progressBar } from '../hooks/theme.ts';

describe('theme', () => {
  test('the connection and result tables use theme keys and single symbols', () => {
    for (const style of [...Object.values(CONNECTION), ...Object.values(RESULT)]) {
      expect(THEME_KEYS).toContain(style.color);
      expect([...style.icon]).toHaveLength(1);
    }
    expect(RESULT.ok.icon).toBe('✓');
    expect(RESULT.error.icon).toBe('✕');
    expect(THEME_KEYS).toContain('subtle');
  });

  test('every status has its own symbol, so it reads without colour', () => {
    const icons = Object.values(STATUS).map((style) => style.icon);
    expect(new Set(icons).size).toBe(icons.length);
    const labels = Object.values(STATUS).map((style) => style.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('colours are theme keys, never literal values', () => {
    for (const style of [...Object.values(STATUS), ...Object.values(DELIVERY)])
      expect(THEME_KEYS).toContain(style.color);
  });

  test('symbols are single BMP characters, no emoji', () => {
    for (const style of [...Object.values(STATUS), ...Object.values(DELIVERY)])
      expect([...style.icon]).toHaveLength(1);
  });

  test('the failed status is an error cross', () => {
    expect(STATUS.failed).toMatchObject({ icon: '✕', label: 'failed', color: 'error' });
    expect(DELIVERY.applied.icon).toBe('✓');
  });

  test('a group held back by the scheduler has its own muted status', () => {
    expect(STATUS.waiting).toMatchObject({ icon: '◷', label: 'waiting', color: 'inactive' });
  });

  test('the progress bar is ten cells by default', () => {
    expect(progressBar(3, 5)).toBe('▰▰▰▰▰▰▱▱▱▱');
    expect(progressBar(0, 5)).toBe('▱▱▱▱▱▱▱▱▱▱');
    expect(progressBar(5, 5)).toBe('▰▰▰▰▰▰▰▰▰▰');
    expect(progressBar(0, 0)).toBe('▱▱▱▱▱▱▱▱▱▱');
    expect(progressBar(9, 5)).toBe('▰▰▰▰▰▰▰▰▰▰');
    expect(progressBar(1, 2, 4)).toBe('▰▰▱▱');
  });
});
