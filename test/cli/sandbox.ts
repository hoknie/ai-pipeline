import { execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach } from 'vitest';

import { socketPath } from '../../src/config/index.ts';
import { request } from '../../src/protocol/index.ts';
import { WORKFLOW_CONFIG } from '../daemon/harness.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';

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

afterEach(async () => {
  for (const sandbox of sandboxes.splice(0)) {
    closed.add(sandbox.socket);
    for (const child of inFlight.get(sandbox.socket) ?? []) child.kill('SIGKILL');
    inFlight.delete(sandbox.socket);
    await request(sandbox.socket, 'shutdown', {}).catch(() => undefined);
    // A daemon a killed `aip` call was starting may not listen yet: stop it by its pid.
    stopDaemon(sandbox);
  }
});

export function sandbox(config = WORKFLOW_CONFIG): Sandbox {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-cli-')));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  for (const args of [
    ['config', 'user.name', 'T'],
    ['config', 'user.email', 't@e.com'],
  ]) {
    execFileSync('git', args, { cwd: repo });
  }
  writeConfigDirectory(repo, config);
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  writeFileSync(join(base, 'script.json'), '{}');
  const env = {
    ...process.env,
    XDG_STATE_HOME: join(base, 'state'),
    XDG_CONFIG_HOME: join(base, 'config'),
    // Tests of the autostart turn it on again; the others must not take the default port.
    AIP_WEB_AUTOSTART: '0',
    AIP_CLAUDE_BIN: join(fakes, 'claude'),
    AIP_OPENCODE_BIN: join(fakes, 'opencode'),
    AIP_FAKE_STATE: join(base, 'fake'),
    AIP_FAKE_SCRIPT: join(base, 'script.json'),
  };
  const state = join(base, 'state', 'aip');
  const created = { repo, env, socket: socketPath(state), state };
  sandboxes.push(created);
  return created;
}

export function aip(
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

/**
 * Polls `check` every 100 ms until it holds; fails after `timeoutMs`, well inside the test
 * timeout, so a stuck wait reports what it waited for instead of timing the test out.
 */
export async function waitUntil(
  what: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The run of the answer of `aip run start --json`; fails when the task waits. */
export function runOf(stdout: string): { runId: string } {
  const { run } = JSON.parse(stdout) as { run: { runId: string } | null };
  if (!run) throw new Error('the task waits in the queue');
  return run;
}
