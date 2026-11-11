import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startDaemon, type RunningDaemon } from '../../src/app/index.ts';
import type { ApplicationOptions as DaemonOptions, DaemonTimings } from '../../src/app/index.ts';
import { request } from '../../src/presentation/ipc/client/index.ts';
import type {
  GroupView,
  ParamsOf,
  RunCreated,
  RunQueued,
  RunView,
} from '../../src/presentation/ipc/contract/index.ts';
import { copyTemplateRepo } from '../fixtures/template-repo.ts';

const root = join(import.meta.dirname, '..', '..');
const fakes = join(root, 'test', 'fakes');

/**
 * Short durations of the test daemons: a `timeout: 1s` lasts 50 ms and a stopped agent is killed
 * after 100 ms.
 */
export const TEST_TIMINGS: DaemonTimings = {
  timeoutUnitMs: 50,
  drainMs: 50,
  stopGraceMs: 100,
  killGraceMs: 100,
  wakeMarginMs: 20,
  usageIntervalMs: 20,
  namingTimeoutMs: 10_000,
  processStreamMs: 2000,
  processKillLookMs: 20,
  processCacheMs: 20,
  statsSettingsMs: 20,
};

export const PIPELINE_CONFIG = `swarm:
  max: 3
  specialists:
    coder: { name: Кодировщик }
    reviewer: { name: Ревьюер, permissions: read }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 } }
`;

/** One step: for tests of the queue and the places, where only the number of runs matters. */
export const CODE_ONLY_CONFIG = `swarm:
  max: 3
  specialists:
    coder: { name: Кодировщик }
    reviewer: { name: Ревьюер, permissions: read }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;

export const MANUAL_CONFIG = `${PIPELINE_CONFIG}  delivery: { auto: false }\n`;

export interface Harness {
  repo: string;
  state: string;
  fakeState: string;
  socket: string;
  running: RunningDaemon;
  environment: NodeJS.ProcessEnv;
  script(steps: Record<string, unknown>): void;
  /**
   * Path of a gate: an action `{ waitFor: h.gate('a') }` holds the agent until the test calls
   * `h.open('a')`. Holds an agent exactly as long as the test needs, instead of a fixed `delayMs`.
   */
  gate(name: string): string;
  open(name: string): void;
  call<M extends Parameters<typeof request>[1]>(method: M, params: ParamsOf<M>): Promise<unknown>;
  status(runId: string): Promise<RunView>;
  group(runId: string, group: string): Promise<GroupView>;
  waitFor(runId: string, done: (run: RunView) => boolean, timeoutMs?: number): Promise<RunView>;
  /** Stops the daemon, runs `between` while it is down, starts it again. */
  restart(between?: () => void): Promise<void>;
  close(): Promise<void>;
}

/** Interval of the polling helpers: short, so a test goes on as soon as its condition holds. */
export const POLL_MS = 20;

/** Polls `check` until it holds; fails after `timeoutMs` naming what it waited for. */
export async function until(
  what: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * For a negative check ("nothing else happens"): requests to the daemon are handled in order, so
 * the round trips below return after everything it had under way; the last pause (at most
 * 50 ms) only lets an event that must not come travel to the subscriber.
 */
export async function settle(h: Pick<Harness, 'call'>): Promise<void> {
  for (let round = 0; round < 3; round += 1) await h.call('status', {});
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export async function harness(
  config = PIPELINE_CONFIG,
  environment: NodeJS.ProcessEnv = {},
  options: Pick<
    DaemonOptions,
    'build' | 'panel' | 'processesIntervalMs' | 'snapshotProcesses' | 'timings' | 'now'
  > = {},
): Promise<Harness> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-daemon-')));
  const repo = join(base, 'repo');
  const state = join(base, 'state');
  const fakeState = join(base, 'fake');
  mkdirSync(join(base, 'xdg'), { recursive: true });
  copyTemplateRepo(repo, config, { 'lib.ts': 'export const value = 1;\n' });
  const gates = join(base, 'gates');
  mkdirSync(gates);
  const scriptPath = join(base, 'script.json');
  writeFileSync(scriptPath, '{}');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_CONFIG_HOME: join(base, 'xdg'),
    AIP_CLAUDE_BIN: join(fakes, 'claude'),
    AIP_OPENCODE_BIN: join(fakes, 'opencode'),
    AIP_AGY_BIN: join(fakes, 'agy'),
    AIP_FAKE_STATE: fakeState,
    AIP_FAKE_SCRIPT: scriptPath,
    ...environment,
  };
  const start = () =>
    startDaemon({
      stateDirectory: state,
      entry: [process.execPath, join(root, 'src', 'cli', 'main.ts')],
      environment: env,
      ...options,
      timings: { ...TEST_TIMINGS, ...options.timings },
    });
  let running = await start();
  const socket = running.application.socket;
  const call = <M extends Parameters<typeof request>[1]>(method: M, params: ParamsOf<M>) =>
    request(socket, method, params);
  const status = async (runId: string) => (await call('status', { runId })) as RunView;
  return {
    repo,
    state,
    fakeState,
    socket,
    get running() {
      return running;
    },
    environment: env,
    script(steps) {
      writeFileSync(scriptPath, JSON.stringify(steps));
    },
    gate: (name) => join(gates, name),
    open(name) {
      writeFileSync(join(gates, name), '');
    },
    call,
    status,
    async group(runId, group) {
      return (await call('group', { runId, group, tailLines: 50 })) as GroupView;
    },
    async waitFor(runId, done, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const view = await status(runId);
        if (done(view)) return view;
        if (Date.now() > deadline)
          throw new Error(`timed out waiting; last status: ${JSON.stringify(view)}`);
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
    async restart(between) {
      await running.close();
      between?.();
      running = await start();
    },
    async close() {
      await running.close();
    },
  };
}

export function git(cwd: string, ...args: string[]): string {
  return sh(cwd, ...args);
}

export function statuses(run: RunView): string[] {
  return run.groups.map((group) => group.status);
}

/** Queues a pipeline task and returns the run the queue created for it; fails when the task waits. */
export async function startRun(
  h: Pick<Harness, 'call'>,
  params: ParamsOf<'run'>,
): Promise<RunCreated> {
  const queued = (await h.call('run', params)) as RunQueued;
  if (!queued.run) throw new Error(`the task ${queued.item} waits in the queue`);
  return queued.run;
}
