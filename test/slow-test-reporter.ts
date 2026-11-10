import type { Reporter, TestCase, TestModule } from 'vitest/node';

export const TEST_LIMIT_MS = 400;
/** Limit of the `e2e` project: tests with a daemon, real git repositories and agent processes. */
export const E2E_LIMIT_MS = 5000;
/** Limit of the `web` project: every test draws the panel in jsdom, which slows with the load. */
export const WEB_LIMIT_MS = 1000;

export interface SlowTest {
  file: string;
  name: string;
  durationMs: number;
  limitMs?: number;
}

/** The effective limit: `AIP_TEST_LIMIT_MS` can only raise the default. */
export function effectiveLimit(
  env: NodeJS.ProcessEnv = process.env,
  base: number = TEST_LIMIT_MS,
): number {
  const raw = env.AIP_TEST_LIMIT_MS;
  if (raw === undefined || raw.trim() === '') return base;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < base) return base;
  return value;
}

/** The limit of a vitest project: the end-to-end project has its own, web 1000 ms, every other one 400 ms. */
export function projectLimit(
  projectName: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return effectiveLimit(
    env,
    projectName === 'e2e' ? E2E_LIMIT_MS : projectName === 'web' ? WEB_LIMIT_MS : TEST_LIMIT_MS,
  );
}

/** True under CI (`CI` set and not `false`/`0`): there slow tests are only listed, the run does not fail. */
export function isCi(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CI?.trim().toLowerCase();
  return raw !== undefined && raw !== '' && raw !== 'false' && raw !== '0';
}

export function formatSlowTests(slow: SlowTest[], limitMs: number): string[] {
  return [...slow]
    .sort((a, b) => b.durationMs - a.durationMs)
    .map(
      (t) =>
        `${t.file} > ${t.name}: ${Math.round(t.durationMs)} ms (limit ${t.limitMs ?? limitMs} ms)`,
    );
}

export interface SlowTestReporterOptions {
  /** When true a slow test makes the run fail; by default everywhere but CI. */
  enforce?: boolean;
  env?: NodeJS.ProcessEnv;
  write?: (line: string) => void;
}

export default class SlowTestReporter implements Reporter {
  readonly slow: SlowTest[] = [];
  private readonly enforce: boolean;
  private readonly limitMs: number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly write: (line: string) => void;

  constructor(options: SlowTestReporterOptions = {}) {
    this.env = options.env ?? process.env;
    this.enforce = options.enforce ?? !isCi(this.env);
    this.limitMs = effectiveLimit(this.env);
    this.write = options.write ?? ((line) => process.stderr.write(`${line}\n`));
  }

  /** Records one finished test case; failed and skipped tests are not counted. */
  record(testCase: TestCase): void {
    const result = testCase.result();
    if (result.state !== 'passed') return;
    const duration = testCase.diagnostic()?.duration ?? 0;
    const limit = projectLimit(testCase.project?.name, this.env);
    if (duration <= limit) return;
    this.slow.push({
      file: testCase.module.moduleId,
      name: testCase.fullName,
      durationMs: duration,
      limitMs: limit,
    });
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    for (const mod of testModules) for (const t of mod.children.allTests()) this.record(t);
    this.report();
  }

  report(): void {
    if (this.slow.length === 0) return;
    this.write('Tests slower than their limit:');
    for (const line of formatSlowTests(this.slow, this.limitMs)) this.write(line);
    if (this.enforce) process.exitCode = 1;
  }
}
