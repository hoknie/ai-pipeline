import { afterEach, describe, expect, it } from 'vitest';
import type { TestCase } from 'vitest/node';

import SlowTestReporter, {
  E2E_LIMIT_MS,
  WEB_LIMIT_MS,
  TEST_LIMIT_MS,
  effectiveLimit,
  formatSlowTests,
  projectLimit,
} from './slow-test-reporter.ts';

function fakeCase(name: string, duration: number, state = 'passed', project?: string): TestCase {
  return {
    project: project === undefined ? undefined : { name: project },
    fullName: name,
    module: { moduleId: 'test/a.test.ts' },
    result: () => ({ state }),
    diagnostic: () => ({ duration }),
  } as unknown as TestCase;
}

const exitCode = process.exitCode;
afterEach(() => {
  process.exitCode = exitCode;
});

describe('slow test reporter', () => {
  it('keeps the limit at 400 ms and lets the variable only raise it', () => {
    expect(TEST_LIMIT_MS).toBe(400);
    expect(effectiveLimit({})).toBe(400);
    expect(effectiveLimit({ AIP_TEST_LIMIT_MS: '100' })).toBe(400);
    expect(effectiveLimit({ AIP_TEST_LIMIT_MS: 'abc' })).toBe(400);
    expect(effectiveLimit({ AIP_TEST_LIMIT_MS: '900' })).toBe(900);
  });

  it('lists slow tests from the slowest, with file, name and limit', () => {
    const lines = formatSlowTests(
      [
        { file: 'a', name: 'x', durationMs: 450 },
        { file: 'b', name: 'y', durationMs: 900 },
      ],
      400,
    );
    expect(lines).toEqual(['b > y: 900 ms (limit 400 ms)', 'a > x: 450 ms (limit 400 ms)']);
  });

  it('stays quiet when every test is fast, and ignores failed tests', () => {
    const lines: string[] = [];
    const reporter = new SlowTestReporter({ enforce: true, env: {}, write: (l) => lines.push(l) });
    reporter.record(fakeCase('fast', 399));
    reporter.record(fakeCase('failed', 5000, 'failed'));
    reporter.report();
    expect(lines).toEqual([]);
    expect(process.exitCode).toBe(exitCode);
  });

  it('fails the run on a slow test when enforcing, and only prints otherwise', () => {
    const lines: string[] = [];
    const reporter = new SlowTestReporter({ enforce: true, env: {}, write: (l) => lines.push(l) });
    reporter.record(fakeCase('suite > slow', 450));
    reporter.report();
    expect(lines.join('\n')).toContain('test/a.test.ts > suite > slow: 450 ms (limit 400 ms)');
    expect(process.exitCode).toBe(1);

    process.exitCode = exitCode;
    const printing = new SlowTestReporter({ enforce: false, env: {}, write: () => undefined });
    printing.record(fakeCase('slow', 450));
    printing.report();
    expect(process.exitCode).toBe(exitCode);
  });

  describe('limits of the projects', () => {
    const run = (cases: TestCase[], env: NodeJS.ProcessEnv = {}) => {
      const lines: string[] = [];
      const reporter = new SlowTestReporter({ enforce: true, env, write: (l) => lines.push(l) });
      for (const testCase of cases) reporter.record(testCase);
      reporter.report();
      return lines.join('\n');
    };

    it('gives e2e 3000 ms, web 1000 ms and every other project 400 ms', () => {
      expect(E2E_LIMIT_MS).toBe(3000);
      expect(projectLimit('e2e', {})).toBe(3000);
      expect(projectLimit('unit', {})).toBe(400);
      expect(WEB_LIMIT_MS).toBe(1000);
      expect(projectLimit('web', {})).toBe(1000);
      expect(projectLimit(undefined, {})).toBe(400);
    });

    it('lets an end-to-end test of 2000 ms pass and stops one of 3001 ms', () => {
      expect(run([fakeCase('e2e fast', 2000, 'passed', 'e2e')])).toBe('');
      expect(process.exitCode).toBe(exitCode);
      const out = run([fakeCase('e2e slow', 3001, 'passed', 'e2e')]);
      expect(out).toContain('test/a.test.ts > e2e slow: 3001 ms (limit 3000 ms)');
      expect(process.exitCode).toBe(1);
    });

    it('holds unit tests to 400 ms and web tests to 1000 ms', () => {
      const out = run([
        fakeCase('u', 1000, 'passed', 'unit'),
        fakeCase('w', 1100, 'passed', 'web'),
      ]);
      expect(out).toContain('u: 1000 ms (limit 400 ms)');
      expect(out).toContain('w: 1100 ms (limit 1000 ms)');
      expect(run([fakeCase('w2', 900, 'passed', 'web')])).toBe('');
    });

    it('lets the variable raise the limit of a project and never lower it', () => {
      expect(projectLimit('e2e', { AIP_TEST_LIMIT_MS: '500' })).toBe(3000);
      expect(projectLimit('e2e', { AIP_TEST_LIMIT_MS: '4000' })).toBe(4000);
      expect(projectLimit('unit', { AIP_TEST_LIMIT_MS: '1000' })).toBe(1000);
      const out = run([fakeCase('e2e', 3500, 'passed', 'e2e')], { AIP_TEST_LIMIT_MS: '100' });
      expect(out).toContain('(limit 3000 ms)');
    });
  });
});
