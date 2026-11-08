import { execFile, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach } from 'vitest';

import { socketPath } from '../../src/platform/paths/index.ts';
import { startDaemon, type RunningDaemon } from '../../src/app/index.ts';
import { request } from '../../src/presentation/ipc/client/index.ts';
import type { CliIo } from '../../src/presentation/cli/io.ts';
import { runCli } from '../../src/presentation/cli/program.ts';
import { TEST_TIMINGS, PIPELINE_CONFIG } from '../daemon/harness.ts';
import { copyTemplateRepo } from '../fixtures/template-repo.ts';
import { waitUntil } from '../fixtures/wait-until.ts';

export { waitUntil };

// Shared by the cli test files; importing this module shuts down the daemons of the sandboxes after
// every test.
export const root = join(import.meta.dirname, '..', '..');
export const main = join(root, 'src', 'cli', 'main.ts');
export const fakes = join(root, 'test', 'fakes');

export interface Sandbox {
  repo: string;
  env: NodeJS.ProcessEnv;
  socket: string;
  /** State directory of the daemon of the sandbox, with its aip.pid. */
  state: string;
}

const sandboxes: Sandbox[] = [];
/**
 * Sockets of sandboxes torn down already. A test that timed out keeps running after
 * afterEach; its next `aip` call would start a daemon that nobody stops. Keyed by the
 * socket, because tests pass copies of a sandbox with another env.
 */
const closed = new Set<string>();
/** `aip` processes still running, by socket: killed on teardown before they start a daemon. */
const inFlight = new Map<string, Set<ChildProcess>>();

function stopDaemon(sandbox: Sandbox): void {
  const pidFile = join(sandbox.state, 'aip.pid');
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already stopped
  }
}

/** Daemons started in this process, by socket. */
const daemons = new Map<string, Promise<RunningDaemon>>();

async function teardown(list: Sandbox[]): Promise<void> {
  for (const sandbox of list.splice(0)) {
    closed.add(sandbox.socket);
    const own = daemons.get(sandbox.socket);
    daemons.delete(sandbox.socket);
    await (await own)?.close().catch(() => undefined);
    for (const child of inFlight.get(sandbox.socket) ?? []) child.kill('SIGKILL');
    inFlight.delete(sandbox.socket);
    await request(sandbox.socket, 'shutdown', {}).catch(() => undefined);
    // A daemon a killed `aip` call was starting may not listen yet: stop it by its pid.
    stopDaemon(sandbox);
  }
}

afterEach(() => teardown(sandboxes));
afterAll(() => teardown(shared));

/** Sandboxes of a `beforeAll`: they live until the end of the file, not of one test. */
const shared: Sandbox[] = [];

export function sandbox(config = PIPELINE_CONFIG, options: { shared?: boolean } = {}): Sandbox {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-cli-')));
  const repo = join(base, 'repo');
  copyTemplateRepo(repo, config);
  writeFileSync(join(base, 'script.json'), '{}');
  const env = {
    ...process.env,
    XDG_STATE_HOME: join(base, 'state'),
    XDG_CONFIG_HOME: join(base, 'config'),
    // Tests of the autostart turn it on again; the others must not take the default port.
    AIP_WEB_AUTOSTART: '0',
    AIP_CLAUDE_BIN: join(fakes, 'claude'),
    AIP_OPENCODE_BIN: join(fakes, 'opencode'),
    AIP_AGY_BIN: join(fakes, 'agy'),
    AIP_FAKE_STATE: join(base, 'fake'),
    AIP_FAKE_SCRIPT: join(base, 'script.json'),
  };
  const state = join(base, 'state', 'aip');
  const created = { repo, env, socket: socketPath(state), state };
  (options.shared ? shared : sandboxes).push(created);
  return created;
}

export function aipProcess(
  box: Sandbox,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (closed.has(box.socket)) {
    return Promise.reject(new Error('the sandbox is torn down: the test outlived its timeout'));
  }
  return new Promise((resolve) => {
    const running = inFlight.get(box.socket) ?? new Set<ChildProcess>();
    inFlight.set(box.socket, running);
    const child = execFile(
      process.execPath,
      [main, ...args],
      { cwd: box.repo, env: box.env, timeout: 60_000 },
      (error, stdout, stderr) => {
        running.delete(child);
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
      },
    );
    running.add(child);
  });
}

/** The run of the answer of `aip run start --json`; fails when the task waits. */
export function runOf(stdout: string): { runId: string } {
  const { run } = JSON.parse(stdout) as { run: { runId: string } | null };
  if (!run) throw new Error('the task waits in the queue');
  return run;
}

/** Starts the daemon of the sandbox inside the test process, once. */
export function ownDaemon(box: Sandbox): Promise<RunningDaemon> {
  let daemon = daemons.get(box.socket);
  if (!daemon) {
    daemon = startDaemon({
      stateDirectory: box.state,
      entry: [process.execPath, main],
      environment: box.env,
      timings: TEST_TIMINGS,
    });
    daemons.set(box.socket, daemon);
  }
  return daemon;
}

let running: Promise<unknown> = Promise.resolve();

/**
 * Runs `aip` inside the test process against a daemon of the test process: no node process is
 * started per call. The environment, the working directory and the output streams are the
 * sandbox's for the duration of the call; calls run one after another.
 */
export function aip(
  box: Sandbox,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const call = running.then(() => inProcess(box, args));
  running = call.catch(() => undefined);
  return call;
}

async function inProcess(
  box: Sandbox,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (closed.has(box.socket)) {
    throw new Error('the sandbox is torn down: the test outlived its timeout');
  }
  await ownDaemon(box);
  const savedEnv = { ...process.env };
  const savedCwd = process.cwd();
  const savedExitCode = process.exitCode;
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  const consoleMethods = {
    log: console.log,
    info: console.info,
    error: console.error,
    warn: console.warn,
  };
  let stdout = '';
  let stderr = '';
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, box.env);
  process.chdir(box.repo);
  process.exitCode = undefined;
  const text = (parts: unknown[]) => `${parts.map(String).join(' ')}\n`;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  console.log = console.info = (...parts: unknown[]) => void (stdout += text(parts));
  console.error = console.warn = (...parts: unknown[]) => void (stderr += text(parts));
  const io: CliIo = {
    cwd: box.repo,
    env: box.env,
    isTTY: false,
    entry: [process.execPath, main],
    pid: process.pid,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    setExitCode: (code) => {
      process.exitCode = code;
    },
    exit: (code) => process.exit(code),
    onSignal: (signal, handler) => void process.once(signal, handler),
    watchIntervalMs: 25,
    panelPollMs: 25,
  };
  try {
    await runCli([process.execPath, main, ...args], io);
    return { code: Number(process.exitCode ?? 0), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    Object.assign(console, consoleMethods);
    process.chdir(savedCwd);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    process.exitCode = savedExitCode;
  }
}
