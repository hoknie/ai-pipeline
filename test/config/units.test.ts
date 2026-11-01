import { describe, expect, it } from 'vitest';

import { configPaths } from '../../src/config/discover.ts';
import { formatDuration, parseDuration } from '../../src/config/duration.ts';
import { mergeConfigs } from '../../src/config/merge.ts';
import { isValidSlug } from '../../src/config/model.ts';
import { buildPrompt } from '../../src/config/prompt.ts';

describe('durations', () => {
  it('parses seconds, minutes and hours', () => {
    expect(parseDuration('90s')).toBe(90);
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('2h')).toBe(7200);
  });

  it('rejects an unknown unit, an empty number, zero and negatives', () => {
    for (const value of ['30x', 'm', '0s', '-5m', '', '1.5h']) {
      expect(parseDuration(value)).toBeNull();
    }
  });

  it('formats in the largest whole unit', () => {
    expect(formatDuration(7200)).toBe('2h');
    expect(formatDuration(1800)).toBe('30m');
    expect(formatDuration(90)).toBe('90s');
  });
});

describe('slugs', () => {
  it('accepts lowercase letters, digits and dashes up to 32 characters', () => {
    expect(isValidSlug('coder')).toBe(true);
    expect(isValidSlug('qa-2')).toBe(true);
    expect(isValidSlug(`a${'b'.repeat(31)}`)).toBe(true);
  });

  it('rejects uppercase, underscores, a leading digit and long slugs', () => {
    for (const value of ['Code_R', '2qa', '', `a${'b'.repeat(32)}`]) {
      expect(isValidSlug(value)).toBe(false);
    }
  });
});

describe('prompt assembly', () => {
  it('substitutes the task for every placeholder', () => {
    expect(buildPrompt('Сделай: %s', 'добавить логин')).toBe('Сделай: добавить логин');
    expect(buildPrompt('%s и ещё %s', 'x')).toBe('x и ещё x');
    expect(buildPrompt('Проверь: %s', 'логин', 'Только тесты')).toBe(
      'Проверь: логин\n\nТолько тесты',
    );
    expect(buildPrompt('Проверь изменения', 'логин', 'Только тесты')).toBe(
      'Проверь изменения\n\nлогин\n\nТолько тесты',
    );
    expect(buildPrompt(null, 'логин', '  Только backend  ')).toBe('логин\n\nТолько backend');
    expect(buildPrompt('Сделай: %s', 'x', 'Покрытие не ниже 80% и без %s')).toBe(
      'Сделай: x\n\nПокрытие не ниже 80% и без %s',
    );
    expect(buildPrompt('Сделай: %s', 'x', null)).toBe(buildPrompt('Сделай: %s', 'x'));
  });

  it('appends the task as a paragraph when there is no placeholder', () => {
    expect(buildPrompt('Проверь изменения и выведи QA Check List\n', 'добавить логин')).toBe(
      'Проверь изменения и выведи QA Check List\n\nдобавить логин',
    );
  });

  it('uses the task alone without a prompt', () => {
    expect(buildPrompt(null, 'добавить логин')).toBe('добавить логин');
  });

  it('treats a double percent as a literal percent', () => {
    expect(buildPrompt('100%% готово: %s', 'x')).toBe('100% готово: x');
    expect(buildPrompt('%%s', 'x')).toBe('%s\n\nx');
    expect(buildPrompt('50% и %d', 'x')).toBe('50% и %d\n\nx');
  });
});

describe('config discovery', () => {
  it('puts the global directory under XDG_CONFIG_HOME when it is set', () => {
    expect(configPaths('/repo', '/xdg', '/home/user')).toEqual({
      global: {
        directory: '/xdg/aip',
        legacy: ['/xdg/aip/swarm.yaml', '/xdg/aip/swarm.d'],
      },
      project: { directory: '/repo/aip', legacy: ['/repo/swarm.yaml', '/repo/swarm.d'] },
    });
  });

  it('falls back to ~/.config and ignores a relative XDG_CONFIG_HOME', () => {
    expect(configPaths('/repo', undefined, '/home/user').global.directory).toBe(
      '/home/user/.config/aip',
    );
    expect(configPaths('/repo', 'relative', '/home/user').global.directory).toBe(
      '/home/user/.config/aip',
    );
    expect(configPaths('/repo', undefined, '/home/user').global.legacy).toContain(
      '/home/user/.config/aip/swarm.d',
    );
  });
});

describe('merging', () => {
  it('replaces a global specialist with the project one as a whole', () => {
    const merged = mergeConfigs(
      {
        swarm: {
          specialists: { coder: { name: 'C', model: 'a', skills: ['x'] }, qa: { name: 'Q' } },
        },
      },
      { swarm: { specialists: { coder: { name: 'C', model: 'b' } } } },
    );
    expect(merged).toEqual({
      swarm: { specialists: { coder: { name: 'C', model: 'b' }, qa: { name: 'Q' } } },
    });
  });

  it('merges defaults field by field and overrides max', () => {
    const merged = mergeConfigs(
      { swarm: { max: 2, defaults: { runtime: 'opencode', timeout: '10m' } } },
      { swarm: { max: 5, defaults: { timeout: '1h' } } },
    );
    expect(merged).toEqual({ swarm: { max: 5, defaults: { runtime: 'opencode', timeout: '1h' } } });
  });

  it('takes a single file as it is', () => {
    const only = { swarm: { max: 4 } };
    expect(mergeConfigs(undefined, only)).toBe(only);
    expect(mergeConfigs(only, undefined)).toBe(only);
  });
});
