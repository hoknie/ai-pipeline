import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const hasJust = spawnSync('just', ['--version']).error === undefined;

function just(...args: string[]): string {
  const result = spawnSync('just', args, { cwd: resolve('.'), encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return `${result.stdout}${result.stderr}`;
}

describe.skipIf(!hasJust)('justfile', () => {
  it('lists every recipe', () => {
    const summary = just('--summary').split(/\s+/);
    for (const name of [
      'check',
      'build',
      'link',
      'web',
      'web-build',
      'web-restart',
      'web-stop',
      'web-status',
      'web-log',
      'web-dev',
    ])
      expect(summary).toContain(name);
  });

  it('groups the recipes', () => {
    const list = just('--list');
    for (const group of ['[quality]', '[build]', '[web]']) expect(list).toContain(group);
  });

  it('runs the gate through npm', () => {
    expect(just('--dry-run', 'check')).toContain('npm run check');
  });

  it('builds the frontend before restarting', () => {
    const output = just('--dry-run', 'web', '9999');
    const build = output.indexOf('vite build');
    const restart = output.indexOf('aip-web.sh restart 9999');
    expect(build).toBeGreaterThanOrEqual(0);
    expect(restart).toBeGreaterThan(build);
  });
});

describe('justfile modules', () => {
  it('imports the three modules, and they exist', () => {
    const text = readFileSync('justfile', 'utf8');
    for (const module of ['quality', 'build', 'web']) {
      expect(text).toContain(`import 'env/justice/${module}.just'`);
      expect(existsSync(`env/justice/${module}.just`)).toBe(true);
    }
  });
});
