import { describe, expect, it } from 'vitest';

import { validateConfig } from '../../../src/feature/swarm-config/services/index.ts';
import { scriptText } from '../../../src/feature/swarm-config/types/index.ts';

function check(action: unknown) {
  return validateConfig({ swarm: { actions: { check: action } } });
}

function errorsOf(action: unknown): { path: string; message: string }[] {
  const result = check(action);
  return result.ok ? [] : result.errors.map(({ path, message }) => ({ path, message }));
}

function runOf(action: unknown): string[] | null | undefined {
  const result = check(action);
  if (!result.ok) return undefined;
  return result.config.actions.find((candidate) => candidate.id === 'check')?.run;
}

describe('run of an action', () => {
  it('reads a string as one script', () => {
    expect(runOf({ run: 'npm test' })).toEqual(['npm test']);
  });

  it('reads a list as scripts in order', () => {
    expect(runOf({ run: ['npm run lint', 'npm test'] })).toEqual(['npm run lint', 'npm test']);
  });

  it('rejects an empty list', () => {
    expect(errorsOf({ run: [] })).toEqual([
      { path: 'swarm.actions.check.run', message: 'must not be empty' },
    ]);
  });

  it('names the element of the list that is empty', () => {
    expect(errorsOf({ run: ['npm test', ''] })).toEqual([
      { path: 'swarm.actions.check.run[1]', message: 'must not be empty' },
    ]);
  });

  it('names the element of the list that is not a string', () => {
    expect(errorsOf({ run: ['npm test', 3] })).toEqual([
      { path: 'swarm.actions.check.run[1]', message: 'must be a string' },
    ]);
  });

  it('rejects a value that is neither a string nor a list', () => {
    expect(errorsOf({ run: 5 })).toEqual([
      { path: 'swarm.actions.check.run', message: 'must be a string or a list of strings' },
    ]);
  });

  it('still rejects `run` together with `specialist`', () => {
    const errors = errorsOf({ run: ['a', 'b'], specialist: 'coder' });
    expect(errors.map((error) => error.path)).toContain('swarm.actions.check');
  });
});

describe('scriptText', () => {
  it('joins the scripts with line breaks', () => {
    expect(scriptText(['a'])).toBe('a');
    expect(scriptText(['a', 'b'])).toBe('a\nb');
  });
});
