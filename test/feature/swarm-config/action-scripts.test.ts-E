import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { validateConfig } from '../../../src/feature/swarm-config/services/index.ts';
import {
  legacyScript,
  type ResolvedConfig,
  withConfigDefaults,
} from '../../../src/feature/swarm-config/types/index.ts';

function check(action: unknown) {
  return validateConfig({ swarm: { actions: { check: action } } });
}

function errorsOf(action: unknown): { path: string; message: string }[] {
  const result = check(action);
  return result.ok ? [] : result.errors.map(({ path, message }) => ({ path, message }));
}

function runOf(action: unknown): string | null | undefined {
  const result = check(action);
  if (!result.ok) return undefined;
  return result.config.actions.find((candidate) => candidate.id === 'check')?.run;
}

const NOT_STRING = 'must be a string (one script; write several commands as lines of it)';

describe('run of an action', () => {
  it('reads a string as it is', () => {
    expect(runOf({ run: 'npm test' })).toBe('npm test');
  });

  it('reads a multi-line string as it is', () => {
    expect(runOf({ run: 'npm run lint\nnpm test\n' })).toBe('npm run lint\nnpm test\n');
  });

  it.each([[[]], [['a', 'b']], [3]])('rejects %j with the path of `run`', (run) => {
    expect(errorsOf({ run })).toEqual([{ path: 'swarm.actions.check.run', message: NOT_STRING }]);
  });

  it('rejects an empty string', () => {
    expect(errorsOf({ run: '' })).toEqual([
      { path: 'swarm.actions.check.run', message: 'must not be empty' },
    ]);
  });

  it('still rejects `run` together with `specialist`', () => {
    const errors = errorsOf({ run: 'a', specialist: 'coder' });
    expect(errors.map((error) => error.path)).toContain('swarm.actions.check');
  });
});

describe('a list of scripts in a stored snapshot', () => {
  function configWith(run: unknown): ResolvedConfig {
    const result = check({ run: 'x' });
    if (!result.ok) throw new Error('invalid');
    const config = structuredClone(result.config);
    config.actions[0]!.run = run as string;
    return withConfigDefaults(config);
  }

  it('keeps a string and turns a one-item list into its item', () => {
    expect(configWith('a').actions[0]?.run).toBe('a');
    expect(configWith(['a']).actions[0]?.run).toBe('a');
  });

  it('stops at the first failure with its code', () => {
    const script = configWith(['exit 2', 'echo after']).actions[0]?.run ?? '';
    const result = spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });

  it('runs the scripts in order', () => {
    const script = legacyScript(['echo one', 'echo two']);
    expect(spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8' }).stdout).toBe('one\ntwo\n');
  });
});
