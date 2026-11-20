import { describe, expect, it } from 'vitest';

import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';
import {
  formatDuration,
  parseDuration,
  mergeConfigs,
  isValidSlug,
  buildPrompt,
} from '../../../src/feature/swarm-config/types/index.ts';

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
    expect(buildPrompt('Do: %s', 'add a login')).toBe('Do: add a login');
    expect(buildPrompt('%s and also %s', 'x')).toBe('x and also x');
    expect(buildPrompt('Check: %s', 'login', 'Tests only')).toBe('Check: login\n\nTests only');
    expect(buildPrompt('Check the changes', 'login', 'Tests only')).toBe(
      'Check the changes\n\nlogin\n\nTests only',
    );
    expect(buildPrompt(null, 'login', '  Backend only  ')).toBe('login\n\nBackend only');
    expect(buildPrompt('Do: %s', 'x', 'Coverage at least 80% and no %s')).toBe(
      'Do: x\n\nCoverage at least 80% and no %s',
    );
    expect(buildPrompt('Do: %s', 'x', null)).toBe(buildPrompt('Do: %s', 'x'));
  });

  it('appends the task as a paragraph when there is no placeholder', () => {
    expect(buildPrompt('Check the changes and print a QA Check List\n', 'add a login')).toBe(
      'Check the changes and print a QA Check List\n\nadd a login',
    );
  });

  it('uses the task alone without a prompt', () => {
    expect(buildPrompt(null, 'add a login')).toBe('add a login');
  });

  it('treats a double percent as a literal percent', () => {
    expect(buildPrompt('100%% done: %s', 'x')).toBe('100% done: x');
    expect(buildPrompt('%%s', 'x')).toBe('%s\n\nx');
    expect(buildPrompt('50% and %d', 'x')).toBe('50% and %d\n\nx');
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
