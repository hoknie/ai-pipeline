import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

import { socketPath } from '../../src/config/index.ts';
import { request } from '../../src/protocol/index.ts';
import { MANUAL_CONFIG, WORKFLOW_CONFIG } from '../daemon/harness.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';

const root = join(import.meta.dirname, '..', '..');
const main = join(root, 'src', 'cli', 'main.ts');
const fakes = join(root, 'test', 'fakes');

interface Sandbox {
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

function sandbox(config = WORKFLOW_CONFIG): Sandbox {
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

function aip(
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
async function waitUntil(
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
function runOf(stdout: string): { runId: string } {
  const { run } = JSON.parse(stdout) as { run: { runId: string } | null };
  if (!run) throw new Error('the task waits in the queue');
  return run;
}

describe('cli', () => {
  it('starts the daemon on first use and shows that there are no runs', async () => {
    const box = sandbox();
    expect(existsSync(box.socket)).toBe(false);
    const result = await aip(box, 'run', 'list');
    expect(result).toMatchObject({ code: 0, stdout: 'No runs yet.\n' });
    expect(await request(box.socket, 'ping', {})).toMatchObject({ pong: true });
  });

  it('runs a task, follows it with watch and shows status and group details', async () => {
    const box = sandbox();
    const started = await aip(box, 'run', 'start', 'feature', '--task', 'Добавить логин', '--json');
    expect(started.code).toBe(0);
    const { runId } = runOf(started.stdout);
    const watched = await aip(box, 'run', 'watch', runId);
    expect(watched.code).toBe(0);
    expect(watched.stdout).toContain('finished');
    const status = await aip(box, 'run', 'show', runId);
    expect(status.stdout).toMatch(/dobavit-login\s+merged\s+review/);
    const group = await aip(box, 'group', 'show', runId, 'dobavit-login', '--tail', '5');
    expect(group.stdout).toContain('#2 review r1');
    expect(group.stdout).toContain('Log of attempt #2');
    const list = await aip(box, 'run', 'list');
    expect(list.stdout).toContain(runId);
  });

  it('starts groups from a file and reports wrong commands with exit code 1', async () => {
    const box = sandbox();
    const file = join(box.repo, '..', 'groups.yaml');
    writeFileSync(file, '- { title: Один, task: первое }\n- { title: Два, task: второе }\n');
    const started = await aip(box, 'run', 'start', 'feature', '--groups', file);
    expect(started.stdout).toContain('Groups: odin (Один), dva (Два)');
    const runId = /Run (\w+) started/.exec(started.stdout)?.[1] ?? '';
    await aip(box, 'run', 'watch', runId);
    const retry = await aip(box, 'group', 'retry', runId, 'odin');
    expect(retry.code).toBe(1);
    expect(retry.stderr).toContain('needs failed, cancelled or conflict');
    expect((await aip(box, 'run', 'start', 'feature')).stderr).toContain(
      'exactly one of --task and --groups',
    );
    expect((await aip(box, 'run', 'start', 'nope', '--task', 'x')).stderr).toContain(
      'unknown workflow `nope`; known: feature',
    );
  });

  it('answers a question and cancels a run', async () => {
    const box = sandbox();
    writeFileSync(
      box.env.AIP_FAKE_SCRIPT!,
      JSON.stringify({
        code: [{ verdict: 'needs_human', feedback: 'Какой вход?' }, { hang: true }],
      }),
    );
    const { runId } = runOf(
      (await aip(box, 'run', 'start', 'feature', '--task', 'вход', '--json')).stdout,
    );
    await waitUntil('the question of the group', async () =>
      (await aip(box, 'run', 'show', runId)).stdout.includes('needs_human'),
    );
    const answered = await aip(box, 'group', 'answer', runId, 'vhod', 'по', 'паролю');
    expect(answered.code).toBe(0);
    const groupCancelled = await aip(box, 'group', 'cancel', runId, 'vhod');
    expect(groupCancelled.stdout).toMatch(/vhod\s+cancelled/);
    const cancelled = await aip(box, 'run', 'cancel', runId);
    expect(cancelled.code).toBe(0);
  });

  it('cleans a finished run and refuses an active one', async () => {
    const box = sandbox();
    writeFileSync(box.env.AIP_FAKE_SCRIPT!, JSON.stringify({ code: [{ hang: true }] }));
    const { runId } = runOf(
      (await aip(box, 'run', 'start', 'feature', '--task', 'x', '--json')).stdout,
    );
    const refused = await aip(box, 'run', 'clean', runId);
    expect(refused).toMatchObject({ code: 1 });
    expect(refused.stderr).toContain('still active');
    await aip(box, 'run', 'cancel', runId);
    const cleaned = await aip(box, 'run', 'clean', runId, '--all');
    expect(cleaned.stdout).toContain(`removed refs/aip/${runId}/run`);
    expect(
      execFileSync('git', ['for-each-ref', 'refs/aip/'], {
        cwd: box.repo,
        encoding: 'utf8',
      }).trim(),
    ).toBe('');
  });

  it('lists finished runs to clean', async () => {
    const box = sandbox();
    const empty = await aip(box, 'run', 'clean');
    expect(empty.stdout).toContain('No finished runs to clean.');
    expect(JSON.parse((await aip(box, 'run', 'clean', '--json')).stdout)).toEqual([]);

    writeFileSync(box.env.AIP_FAKE_SCRIPT!, JSON.stringify({ code: [{ hang: true }] }));
    await aip(box, 'queue', 'parallel', '2');
    const first = runOf(
      (await aip(box, 'run', 'start', 'feature', '--title', 'Первый', '--task', 'a', '--json'))
        .stdout,
    );
    const second = runOf(
      (await aip(box, 'run', 'start', 'feature', '--title', 'Второй', '--task', 'b', '--json'))
        .stdout,
    );
    await aip(box, 'run', 'cancel', first.runId);

    const listed = await aip(box, 'run', 'clean');
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(first.runId);
    expect(listed.stdout).toContain('Первый');
    expect(listed.stdout).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(listed.stdout).toContain('aip run clean <run-id>');
    expect(listed.stdout).not.toContain(second.runId);

    const json = JSON.parse((await aip(box, 'run', 'clean', '--json')).stdout) as Record<
      string,
      unknown
    >[];
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({ id: first.runId, title: 'Первый', repository: box.repo });
    expect(typeof json[0]!.finishedAt).toBe('number');

    expect((await aip(box, 'run', 'clean', '--all')).code).toBe(1);
    expect((await aip(box, 'run', 'clean', first.runId, '--json')).code).toBe(1);

    await aip(box, 'run', 'clean', first.runId);
    expect(JSON.parse((await aip(box, 'run', 'clean', '--json')).stdout)).toEqual([]);
    await aip(box, 'run', 'cancel', second.runId);
  });

  it('checks the configuration, prints CLI versions and warns about full permissions', async () => {
    const box = sandbox(
      WORKFLOW_CONFIG.replace(
        'coder: { name: Кодировщик }',
        'coder: { name: Кодировщик, permissions: full }',
      ),
    );
    const result = await aip(box, 'config', 'check');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('workspace_dir: .aip');
    expect(result.stdout).toMatch(/claude: .*fakes\/claude/);
    expect(result.stdout).toContain('Warning: specialist `coder` has permissions: full');
    expect(result.stdout).toContain('mode: worktree');
    expect(result.stdout).toContain('mcp: isolated');
    expect(result.stdout).toContain('auto: true');
    writeConfigDirectory(box.repo, 'swarm:\n  max: 0\n');
    const broken = await aip(box, 'config', 'check');
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain('swarm.max: must be an integer from 1 to 32');
  });

  it('delivers with aip run apply, refuses with exit code 1 and forces with markers', async () => {
    const box = sandbox(MANUAL_CONFIG);
    writeFileSync(
      box.env.AIP_FAKE_SCRIPT!,
      JSON.stringify({ code: [{ write: { 'feature.ts': 'export const on = true;\n' } }] }),
    );
    const first = runOf(
      (await aip(box, 'run', 'start', 'feature', '--task', 'первое', '--json')).stdout,
    );
    await aip(box, 'run', 'watch', first.runId);
    const applied = await aip(box, 'run', 'apply', first.runId);
    expect(applied).toMatchObject({ code: 0 });
    expect(applied.stdout).toContain('pervoe: applied (feature.ts)');
    expect(readFileSync(join(box.repo, 'feature.ts'), 'utf8')).toBe('export const on = true;\n');
    writeFileSync(
      box.env.AIP_FAKE_SCRIPT!,
      JSON.stringify({ code: [{ write: { 'feature.ts': 'export const on = false;\n' } }] }),
    );
    const second = runOf(
      (await aip(box, 'run', 'start', 'feature', '--task', 'второе', '--json')).stdout,
    );
    await aip(box, 'run', 'watch', second.runId);
    writeFileSync(join(box.repo, 'feature.ts'), 'export const on = 1;\n');
    const refused = await aip(box, 'run', 'apply', second.runId);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain(
      'apply_failed: the changes conflict with your working tree (feature.ts)',
    );
    const forced = await aip(box, 'run', 'apply', second.runId, '--force');
    expect(forced.code).toBe(0);
  });

  it('streams events with aip events and exits with 1 when the daemon stops', async () => {
    const box = sandbox();
    const events = spawn(process.execPath, [main, 'events', '--json'], {
      env: box.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines: string[] = [];
    let buffer = '';
    events.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      lines.push(...parts);
    });
    await waitUntil('the snapshot event', () => lines.length > 0);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ event: 'snapshot', runs: [] });
    await aip(box, 'run', 'start', 'feature', '--task', 'поток');
    await waitUntil('a run event', () => lines.some((line) => line.includes('"event":"run"')));
    expect(lines.some((line) => line.includes('"event":"run"'))).toBe(true);
    const exited = new Promise<number | null>((resolve) =>
      events.once('exit', (code) => resolve(code)),
    );
    await request(box.socket, 'shutdown', {});
    expect(await exited).toBe(1);
  });

  it('prints JSON without ANSI even with FORCE_COLOR=1', async () => {
    const box = sandbox();
    const forced = { ...box, env: { ...box.env, FORCE_COLOR: '1' } };
    const started = await aip(box, 'run', 'start', 'feature', '--task', 'цвет', '--json');
    const { runId } = runOf(started.stdout);
    await aip(box, 'run', 'watch', runId);
    const shown = JSON.parse((await aip(box, 'run', 'show', runId, '--json')).stdout) as {
      groups: { slug: string }[];
      system: unknown[];
      deliveryStage: unknown;
    };
    expect(Array.isArray(shown.system)).toBe(true);
    expect(shown.deliveryStage).toHaveProperty('status');
    const groupName = shown.groups[0]?.slug ?? '';
    const commands = [
      ['run', 'list', '--json'],
      ['queue', 'list', '--json'],
      ['repo', 'list', '--json'],
      ['version', '--json'],
      ['run', 'show', runId, '--json'],
      ['group', 'show', runId, groupName, '--json'],
    ];
    for (const args of commands) {
      const result = await aip(forced, ...args);
      expect(result.code, args.join(' ')).toBe(0);
      expect(() => JSON.parse(result.stdout), args.join(' ')).not.toThrow();
      expect(result.stdout).not.toContain('\x1b[');
    }
  });

  it('colors state words with FORCE_COLOR=1 and keeps pipes and --no-color plain', async () => {
    const box = sandbox();
    const forced = { ...box, env: { ...box.env, FORCE_COLOR: '1' } };
    const started = await aip(box, 'run', 'start', 'feature', '--task', 'цвет', '--json');
    const {
      run: { runId },
    } = JSON.parse(started.stdout) as { run: { runId: string } };
    await aip(box, 'run', 'watch', runId);
    const ansi = /\x1b\[/;
    const badges = /[✓✗▸◦⊘]/;
    for (const args of [
      ['run', 'list'],
      ['run', 'show', runId],
    ]) {
      const colored = await aip(forced, ...args);
      expect(colored.stdout, args.join(' ')).toMatch(ansi);
      expect(colored.stdout, args.join(' ')).toMatch(badges);
      const plain = await aip(box, ...args);
      expect(plain.stdout).not.toMatch(ansi);
      expect(plain.stdout).not.toMatch(badges);
      const off = await aip(forced, ...args, '--no-color');
      expect(off.stdout).not.toMatch(ansi);
      expect(off.stdout).not.toMatch(badges);
    }
    expect((await aip(forced, 'queue', 'list')).stdout).toContain('◦ stopped');
    expect((await aip(forced, 'run', 'list', '--json')).stdout).not.toMatch(ansi);
  });

  it('prints the first line of events --json without ANSI under FORCE_COLOR=1', async () => {
    const box = sandbox();
    const events = spawn(process.execPath, [main, 'events', '--json'], {
      env: { ...box.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const first = await new Promise<string>((resolve) => {
      let buffer = '';
      events.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.includes('\n')) resolve(buffer.split('\n')[0] ?? '');
      });
    });
    events.kill();
    expect(first).not.toContain('\x1b[');
    expect(JSON.parse(first)).toMatchObject({ event: 'snapshot' });
  });

  it('shows examples in help', async () => {
    const box = sandbox();
    const help = await aip(box, 'run', 'start', '--help');
    expect(help.stdout).toContain('Examples:');
    expect(help.stdout).toContain('aip run start feature --task');
  });

  it('prints the version with `aip version`, same as --version', async () => {
    const box = sandbox();
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    const result = await aip(box, 'version');
    expect(result).toMatchObject({ code: 0, stdout: `${version}\n` });
    expect((await aip(box, '--version')).stdout).toBe(result.stdout);
    const help = await aip(box, 'help', 'version');
    expect(help.stdout).toContain('Examples:');
    expect(help.stdout).toContain('aip version');
  });

  it('prints the version as one-line JSON with `aip version --json`', async () => {
    const box = sandbox();
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    const result = await aip(box, 'version', '--json');
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify({ version })}\n`);
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({ version });
    const help = await aip(box, 'help', 'version');
    expect(help.stdout).toContain('--json');
    expect(help.stdout).toContain('aip version --json');
  });

  it('shows claude.settings and warns about claude.edit_mode: auto in config check', async () => {
    const plain = await aip(sandbox(), 'config', 'check');
    expect(plain.stdout).toContain('settings: isolated');
    expect(plain.stdout).not.toContain('claude.edit_mode: auto');
    const box = sandbox(`${WORKFLOW_CONFIG}  claude: { edit_mode: auto, settings: inherit }\n`);
    const result = await aip(box, 'config', 'check');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('edit_mode: auto');
    expect(result.stdout).toContain('settings: inherit');
    expect(result.stdout).toContain(
      'Warning: claude.edit_mode: auto lets the Claude Code classifier decide on commands outside allow_commands',
    );
  });

  it('shows split.workflow and no steps for such a workflow in config check', async () => {
    const box = sandbox(`swarm:
  specialists:
    plan: { name: Планировщик }
    coder: { name: Кодировщик }
  workflows:
    explore:
      steps:
        - { id: research, specialist: coder }
    epic:
      split: { specialist: plan, workflow: explore }
`);
    const result = await aip(box, 'config', 'check');
    expect(result.code).toBe(0);
    const epic = (result.stdout.split('    epic:')[1] ?? '').split('    explore:')[0] ?? '';
    expect(epic).toContain('workflow: explore');
    expect(epic).not.toContain('steps:');
  });

  it('shows max of a specialist in config check only when it is set', async () => {
    const box = sandbox(
      WORKFLOW_CONFIG.replace('coder: { name: Кодировщик }', 'coder: { name: Кодировщик, max: 1 }'),
    );
    const result = await aip(box, 'config', 'check');
    expect(result.code).toBe(0);
    const coder = result.stdout.split('    coder:')[1]?.split('    reviewer:')[0] ?? '';
    const reviewer = result.stdout.split('    reviewer:')[1]?.split('workflows:')[0] ?? '';
    expect(coder).toContain('max: 1');
    expect(reviewer).not.toContain('max:');
  });

  it('lists the configuration files in config check in the order they merge', async () => {
    const box = sandbox();
    writeFileSync(join(box.repo, 'aip', 'specialists', 'b.yaml'), 'name: Второй\n');
    writeFileSync(join(box.repo, 'aip', 'specialists', 'a.yaml'), 'name: Первый\n');
    const result = await aip(box, 'config', 'check');
    expect(result.code).toBe(0);
    const files = result.stdout.split('Config files:\n')[1]?.split('\n\n')[0] ?? '';
    expect(
      files
        .trim()
        .split('\n')
        .map((line) => line.trim()),
    ).toEqual([
      join(box.repo, 'aip', 'settings.yaml'),
      join(box.repo, 'aip', 'specialists', 'a.yaml'),
      join(box.repo, 'aip', 'specialists', 'b.yaml'),
      join(box.repo, 'aip', 'specialists', 'coder.yaml'),
      join(box.repo, 'aip', 'specialists', 'reviewer.yaml'),
      join(box.repo, 'aip', 'workflows', 'feature.yaml'),
    ]);
  });

  it('fails config check with the legacy error when only swarm.yaml is left', async () => {
    const box = sandbox();
    rmSync(join(box.repo, 'aip'), { recursive: true });
    writeFileSync(join(box.repo, 'swarm.yaml'), 'swarm:\n  max: 3\n');
    const result = await aip(box, 'config', 'check');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(join(box.repo, 'swarm.yaml'));
    expect(result.stderr).toContain(join(box.repo, 'aip'));
  });

  it('shows the additional prompt of a step in config check, only where it is set', async () => {
    const box = sandbox(
      WORKFLOW_CONFIG.replace(
        '- { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 } }',
        '- { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 }, additional_prompt: Только тесты }',
      ),
    );
    const result = await aip(box, 'config', 'check');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('additional_prompt: Только тесты');
    expect(result.stdout.match(/additional_prompt/g)).toHaveLength(1);
  });

  it('takes a title for a run and rejects one that is too long', async () => {
    const box = sandbox(MANUAL_CONFIG);
    const long = await aip(
      box,
      'run',
      'start',
      'feature',
      '--title',
      'x'.repeat(61),
      '--task',
      'вход',
    );
    expect(long.code).toBe(1);
    expect(`${long.stdout}${long.stderr}`).toContain('title');
    const created = runOf(
      (
        await aip(
          box,
          'run',
          'start',
          'feature',
          '--title',
          'Вход',
          '--task',
          'сделать вход',
          '--json',
        )
      ).stdout,
    );
    const status = await aip(box, 'run', 'show', created.runId, '--json');
    expect(JSON.parse(status.stdout)).toMatchObject({ title: 'Вход', name: 'vhod' });
    expect((await aip(box, 'run', 'list')).stdout).toContain('Вход');
  });

  it('manages the queue from the terminal', async () => {
    const box = sandbox();
    writeFileSync(
      join(box.repo, 'groups.yaml'),
      '- { title: Вход, task: форма }\n- { title: Выход, task: кнопка }\n',
    );
    const first = await aip(box, 'queue', 'add', 'feature', '--task', 'первая задача', '--json');
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ status: 'stopped', parallel: 1 });
    await aip(box, 'queue', 'add', 'feature', '--groups', 'groups.yaml', '--title', 'Две группы');
    await aip(box, 'queue', 'add', 'feature', '--task', 'третья');
    const list = await aip(box, 'queue', 'list');
    expect(list.stdout).toContain('Queue: stopped, parallel 1');
    expect(list.stdout).toContain('1.');
    expect(list.stdout).toContain('первая задача');
    expect(list.stdout).toContain('2 groups');
    const view = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
      items: { id: string; task: string | null }[];
    };
    const moved = await aip(box, 'queue', 'move', view.items[2]!.id, '1', '--json');
    expect((JSON.parse(moved.stdout) as typeof view).items.map((item) => item.task)).toEqual([
      'третья',
      'первая задача',
      null,
    ]);
    const edited = await aip(box, 'queue', 'edit', view.items[0]!.id, '--task', 'изменённая');
    expect(edited.stdout).toContain('изменённая');
    const removed = await aip(box, 'queue', 'remove', view.items[0]!.id, '--json');
    expect(JSON.parse(removed.stdout).items).toHaveLength(2);
    const bad = await aip(box, 'queue', 'add', 'nope', '--task', 'x');
    expect(bad.code).not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`).toContain('unknown workflow `nope`; known: feature');
    const both = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'x',
      '--groups',
      'groups.yaml',
    );
    expect(both.code).not.toBe(0);
    const now = await aip(box, 'queue', 'run', view.items[1]!.id);
    expect(now.stdout).toContain('started');
    const paused = await aip(box, 'queue', 'pause');
    expect(paused.stdout).toContain('Queue: stopped');
  });

  it('sets the autopilot from the terminal', async () => {
    const box = sandbox();
    const on = await aip(box, 'queue', 'settings', '--autopilot', 'on', '--json');
    expect(on.code).toBe(0);
    expect(JSON.parse(on.stdout)).toMatchObject({
      autopilot: true,
      skipFailed: false,
      parallel: 1,
      status: 'running',
    });
    const text = await aip(box, 'queue', 'settings', '--skip-failed', 'on', '--parallel', '2');
    expect(text.stdout).toContain('parallel 2');
    expect(text.stdout).toContain('autopilot on, skip failed on');
    const list = await aip(box, 'queue', 'list');
    expect(list.stdout).toContain('autopilot on, skip failed on');
    const off = await aip(box, 'queue', 'settings', '--autopilot', 'off', '--json');
    expect(JSON.parse(off.stdout)).toMatchObject({ autopilot: false, skipFailed: true });
  });

  it('refuses a wrong switch value and an empty call of queue settings', async () => {
    const box = sandbox();
    const wrong = await aip(box, 'queue', 'settings', '--autopilot', 'yes');
    expect(wrong.code).not.toBe(0);
    expect(`${wrong.stdout}${wrong.stderr}`).toContain('--autopilot must be on or off');
    const empty = await aip(box, 'queue', 'settings');
    expect(empty.code).not.toBe(0);
    expect(`${empty.stdout}${empty.stderr}`).toContain(
      'pass parallel, autopilot, autopilotAnswer, skipFailed or onLimit',
    );
    const view = await aip(box, 'queue', 'list', '--json');
    expect(JSON.parse(view.stdout)).toMatchObject({ autopilot: false, skipFailed: false });
  });

  it('sets the behaviour on a usage limit and refuses a wrong value', async () => {
    const box = sandbox();
    const wrong = await aip(box, 'queue', 'settings', '--on-limit', 'retry');
    expect(wrong.code).toBe(1);
    expect(`${wrong.stdout}${wrong.stderr}`).toContain('--on-limit must be wait or stop');
    const stop = await aip(box, 'queue', 'settings', '--on-limit', 'stop');
    expect(stop.code).toBe(0);
    expect(stop.stdout.split('\n')[0]).toMatch(/, on limit stop$/);
    const wait = await aip(box, 'queue', 'settings', '--on-limit', 'wait', '--json');
    expect(JSON.parse(wait.stdout)).toMatchObject({ onLimit: 'wait' });
  });

  it('returns a failed run to the queue', async () => {
    const box = sandbox();
    writeFileSync(
      join(box.repo, '..', 'script.json'),
      JSON.stringify({ code: [{ noReport: true }, {}] }),
    );
    expect((await aip(box, 'queue', 'add', 'feature', '--task', 'работа')).code).toBe(0);
    await aip(box, 'queue', 'start');
    let run = '';
    for (let tries = 0; tries < 300 && run === ''; tries += 1) {
      const view = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
        stop: { kind: string; run?: string } | null;
      };
      if (view.stop?.kind === 'problem') run = view.stop.run ?? '';
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const returned = await aip(box, 'queue', 'return', run);
    expect(returned.code).toBe(0);
    expect(returned.stdout).toContain(`returns ${run}`);
    const again = await aip(box, 'queue', 'return', run);
    expect(again.code).toBe(1);
    expect(`${again.stdout}${again.stderr}`).toContain('run is already in the queue');
  });

  it('sets automatic delivery of a run and of queued tasks from flags', async () => {
    const box = sandbox();
    const run = JSON.parse(
      (await aip(box, 'run', 'start', 'feature', '--no-auto-deliver', '--task', 'x', '--json'))
        .stdout,
    ) as { run: { runId: string } };
    expect((await aip(box, 'run', 'show', run.run.runId)).stdout).toContain('manual delivery');
    const added = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'a', '--no-auto-deliver', '--json'))
        .stdout,
    ) as { item: string; items: { autoDeliver: boolean | null }[] };
    expect(added.items[0]?.autoDeliver).toBe(false);
    await aip(box, 'queue', 'add', 'feature', '--task', 'b', '--auto-deliver');
    const waiting = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'c', '--no-auto-deliver', '--json'))
        .stdout,
    ) as { item: string };
    expect((await aip(box, 'queue', 'list')).stdout).toMatch(/auto delivery[\s\S]*manual delivery/);
    const reset = JSON.parse(
      (await aip(box, 'queue', 'edit', waiting.item, '--default-auto-deliver', '--json')).stdout,
    ) as { items: { id: string; autoDeliver: boolean | null }[] };
    expect(reset.items.find((entry) => entry.id === waiting.item)?.autoDeliver).toBeNull();
    const both = await aip(
      box,
      'queue',
      'edit',
      waiting.item,
      '--auto-deliver',
      '--default-auto-deliver',
    );
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--default-auto-deliver');
  });

  it('sets the delivery mode of queued tasks from flags and checks it before the call', async () => {
    const box = sandbox();
    const added = JSON.parse(
      (
        await aip(
          box,
          'queue',
          'add',
          'feature',
          '--task',
          'a',
          '--delivery-mode',
          'commit',
          '--json',
        )
      ).stdout,
    ) as { item: string; items: { deliveryMode: string | null }[] };
    expect(added.items[0]?.deliveryMode).toBe('commit');
    expect((await aip(box, 'queue', 'list')).stdout).toContain('delivery: commit');
    const wrong = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'b',
      '--delivery-mode',
      'tar',
    );
    expect(wrong.code).not.toBe(0);
    expect(wrong.stderr).toContain('--delivery-mode must be one of: worktree, commit, branch');
    const edited = JSON.parse(
      (await aip(box, 'queue', 'edit', added.item, '--delivery-mode', 'branch', '--json')).stdout,
    ) as { items: { deliveryMode: string | null }[] };
    expect(edited.items[0]?.deliveryMode).toBe('branch');
    const reset = JSON.parse(
      (await aip(box, 'queue', 'edit', added.item, '--default-delivery-mode', '--json')).stdout,
    ) as { items: { deliveryMode: string | null }[] };
    expect(reset.items[0]?.deliveryMode).toBeNull();
    const both = await aip(
      box,
      'queue',
      'edit',
      added.item,
      '--delivery-mode',
      'commit',
      '--default-delivery-mode',
    );
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--default-delivery-mode');
    const run = JSON.parse(
      (
        await aip(
          box,
          'run',
          'start',
          'feature',
          '--delivery-mode',
          'branch',
          '--task',
          'x',
          '--json',
        )
      ).stdout,
    ) as { item: string };
    expect(run.item).toBeTruthy();
  });

  it('sets and resets the autopilot answer from flags', async () => {
    const box = sandbox();
    const set = JSON.parse(
      (await aip(box, 'queue', 'settings', '--autopilot-answer', 'Согласен', '--json')).stdout,
    ) as { autopilotAnswer: string | null };
    expect(set.autopilotAnswer).toBe('Согласен');
    expect((await aip(box, 'queue', 'list')).stdout).toContain('Autopilot answer: Согласен');
    const reset = JSON.parse(
      (await aip(box, 'queue', 'settings', '--default-autopilot-answer', '--json')).stdout,
    ) as { autopilotAnswer: string | null };
    expect(reset.autopilotAnswer).toBeNull();
    const both = await aip(
      box,
      'queue',
      'settings',
      '--autopilot-answer',
      'x',
      '--default-autopilot-answer',
    );
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--default-autopilot-answer');
  });

  it('rejects a wrong parallel limit and starts the queue', async () => {
    const box = sandbox();
    await aip(box, 'queue', 'add', 'feature', '--task', 'первая');
    const wrong = await aip(box, 'queue', 'start', '--parallel', '0');
    expect(wrong.code).not.toBe(0);
    const started = await aip(box, 'queue', 'start', '--parallel', '2', '--json');
    expect(JSON.parse(started.stdout)).toMatchObject({ status: 'running', parallel: 2 });
  });

  it('changes parallel of a running queue at once and rejects 0', async () => {
    const box = sandbox();
    await aip(box, 'queue', 'add', 'feature', '--task', 'первая');
    await aip(box, 'queue', 'start');
    await aip(box, 'queue', 'add', 'feature', '--task', 'вторая');
    const raised = await aip(box, 'queue', 'parallel', '2');
    expect(raised.code).toBe(0);
    expect(raised.stdout).toContain('parallel 2 (2 of 2 places taken)');
    const wrong = await aip(box, 'queue', 'parallel', '0');
    expect(wrong.code).not.toBe(0);
    const view = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
      parallel: number;
    };
    expect(view.parallel).toBe(2);
  });

  it('queues `run start` behind busy places and runs a waiting task over the limit', async () => {
    const box = sandbox();
    writeFileSync(box.env.AIP_FAKE_SCRIPT!, JSON.stringify({ code: [{ hang: true }] }));
    const first = await aip(box, 'run', 'start', 'feature', '--task', 'первая', '--json');
    expect(JSON.parse(first.stdout)).toMatchObject({ run: { runId: expect.any(String) } });
    const waiting = await aip(box, 'run', 'start', 'feature', '--task', 'вторая');
    expect(waiting.code).toBe(0);
    expect(waiting.stdout).toContain('queued at position 1');
    expect(waiting.stdout).toContain('1 of 1 places taken');
    const json = JSON.parse(
      (await aip(box, 'run', 'start', 'feature', '--task', 'третья', '--json')).stdout,
    ) as { item: string; run: unknown; queue: { items: unknown[] } };
    expect(json.run).toBeNull();
    expect(json.item).toMatch(/^q/);
    expect(json.queue.items).toHaveLength(2);
    const listed = await aip(box, 'queue', 'list');
    expect(listed.stdout).toMatch(/added \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    const now = await aip(box, 'queue', 'run', json.item);
    expect(now.code).toBe(0);
    expect(now.stdout).toContain('2 of 1 places taken');
  });

  it('serves the host MCP tools over stdio', async () => {
    const box = sandbox(MANUAL_CONFIG);
    const client = new Client({ name: 'test-host', version: '0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [main, 'mcp'],
        cwd: box.repo,
        env: box.env as Record<string, string>,
      }),
    );
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual([
      'swarm_answer',
      'swarm_apply',
      'swarm_cancel',
      'swarm_group',
      'swarm_queue',
      'swarm_queue_add',
      'swarm_queue_edit',
      'swarm_queue_parallel',
      'swarm_queue_pause',
      'swarm_queue_remove',
      'swarm_queue_return',
      'swarm_queue_run_now',
      'swarm_queue_settings',
      'swarm_queue_start',
      'swarm_retry',
      'swarm_run',
      'swarm_status',
    ]);
    const added = await client.callTool({
      name: 'swarm_queue_add',
      arguments: { workflow: 'feature', task: 'Из Claude Code', title: 'Из очереди' },
    });
    expect((added.content as { text: string }[])[0]!.text).toMatch(/Added item q\w+/);
    const raised = await client.callTool({
      name: 'swarm_queue_parallel',
      arguments: { parallel: 3 },
    });
    expect((raised.content as { text: string }[])[0]!.text).toContain('parallel 3');
    const listed = await client.callTool({ name: 'swarm_queue', arguments: {} });
    expect((listed.content as { text: string }[])[0]!.text).toContain('Из очереди');
    const created = await client.callTool({
      name: 'swarm_run',
      arguments: { workflow: 'feature', task: 'Сделать вход', title: 'Вход в систему' },
    });
    const text = (created.content as { text: string }[])[0]!.text;
    expect(text).toContain('started (refs/aip/');
    const runId = /Run (\w+) started/.exec(text)?.[1] ?? '';
    const status = await client.callTool({ name: 'swarm_status', arguments: { run_id: runId } });
    expect((status.content as { text: string }[])[0]!.text).toContain(`Run ${runId}`);
    expect((status.content as { text: string }[])[0]!.text).toContain(
      'Title: Вход в систему (vhod-v-sistemu)',
    );
    expect((status.content as { text: string }[])[0]!.text).toContain('"topology"');
    expect((status.content as { text: string }[])[0]!.text).toContain('"onReject"');
    const wrong = await client.callTool({
      name: 'swarm_group',
      arguments: { run_id: runId, group: 'nope' },
    });
    await waitUntil('the run to finish', async () => {
      const status = await client.callTool({ name: 'swarm_status', arguments: { run_id: runId } });
      return (status.content as { text: string }[])[0]!.text.includes('· finished ·');
    });
    let changes = '';
    await waitUntil('the changes of the group', async () => {
      const group = await client.callTool({
        name: 'swarm_group',
        arguments: { run_id: runId, group: 'sdelat-vhod' },
      });
      changes = (group.content as { text: string }[])[0]!.text;
      return changes.includes('Changes:');
    });
    expect(changes).toMatch(/Changes: \d+ files? \+\d+ −\d+/);
    expect(changes).toContain('"diff"');
    const apply = await client.callTool({ name: 'swarm_apply', arguments: { run_id: runId } });
    expect(apply.isError).toBeFalsy();
    expect((apply.content as { text: string }[])[0]!.text).toContain(': applied');
    expect(wrong.isError).toBe(true);
    await client.close();
  });

  it('starts, reports and stops the daemon with aip daemon', async () => {
    const box = sandbox();
    const first = await aip(box, 'daemon', 'start');
    expect(first.code).toBe(0);
    const pid = /started \(pid (\d+)\)/.exec(first.stdout)?.[1];
    expect(pid).toBeDefined();
    const status = await aip(box, 'daemon', 'status');
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(`aip daemon: running (pid ${pid})`);
    expect(status.stdout).toContain('busy: no');
    const again = await aip(box, 'daemon', 'start');
    expect(again).toMatchObject({ code: 0, stdout: `aip daemon: already running (pid ${pid})\n` });
    const json = JSON.parse((await aip(box, 'daemon', 'status', '--json')).stdout) as {
      running: boolean;
      pid: number;
    };
    expect(json).toMatchObject({ running: true, pid: Number(pid) });
    const stopped = await aip(box, 'daemon', 'stop');
    expect(stopped).toMatchObject({ code: 0, stdout: `aip daemon: stopped (pid ${pid})\n` });
    expect(existsSync(box.socket)).toBe(false);
    expect(existsSync(join(box.state, 'aip.pid'))).toBe(false);
  });

  it('reports a missing daemon without starting it', async () => {
    const box = sandbox();
    const status = await aip(box, 'daemon', 'status', '--json');
    expect(status.code).toBe(3);
    expect(JSON.parse(status.stdout)).toMatchObject({ running: false, pid: null });
    expect(await aip(box, 'daemon', 'status')).toMatchObject({
      code: 3,
      stdout: 'aip daemon: not running\n',
    });
    expect(await aip(box, 'daemon', 'stop')).toMatchObject({
      code: 0,
      stdout: 'aip daemon: not running\n',
    });
    expect(existsSync(box.socket)).toBe(false);
  });

  it('restarts the daemon with a new pid, or just starts it', async () => {
    const box = sandbox();
    const fresh = await aip(box, 'daemon', 'restart');
    expect(fresh.code).toBe(0);
    const pid = /started \(pid (\d+)\)/.exec(fresh.stdout)?.[1];
    expect(pid).toBeDefined();
    const restarted = await aip(box, 'daemon', 'restart');
    expect(restarted.code).toBe(0);
    const next = /restarted \(pid (\d+)\)/.exec(restarted.stdout)?.[1];
    expect(next).toBeDefined();
    expect(next).not.toBe(pid);
    expect((await aip(box, 'daemon', 'status')).stdout).toContain(`(pid ${next})`);
  });

  it('refuses to stop a busy daemon unless --force, and interrupts the step then', async () => {
    const box = sandbox();
    writeFileSync(box.env.AIP_FAKE_SCRIPT!, JSON.stringify({ code: [{ hang: true }] }));
    const { runId } = runOf(
      (await aip(box, 'run', 'start', 'feature', '--task', 'x', '--json')).stdout,
    );
    await waitUntil('the step to run', async () =>
      (await aip(box, 'daemon', 'status')).stdout.includes('busy: yes'),
    );
    const pid = /\(pid (\d+)\)/.exec((await aip(box, 'daemon', 'status')).stdout)?.[1];
    const refused = await aip(box, 'daemon', 'stop');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('--force');
    const kept = await aip(box, 'daemon', 'restart');
    expect(kept.code).toBe(1);
    expect(kept.stderr).toContain('--force');
    expect((await aip(box, 'daemon', 'status')).stdout).toContain(`(pid ${pid})`);
    const forced = await aip(box, 'daemon', 'stop', '--force');
    expect(forced).toMatchObject({ code: 0, stdout: `aip daemon: stopped (pid ${pid})\n` });
    // The next call starts the daemon again; it marks the step it found running as interrupted.
    const shown = await aip(box, 'run', 'show', runId, '--json');
    expect(shown.code).toBe(0);
    expect(shown.stdout).toMatch(/"reason":\s*"interrupted"/);
  });

  it('stops the daemon cleanly on SIGTERM', async () => {
    const box = sandbox();
    const daemon = spawn(process.execPath, [main, 'daemon'], {
      env: box.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve) => daemon.stdout.once('data', () => resolve()));
    const second = await aip(box, 'daemon');
    expect(second.code).toBe(1);
    expect(second.stderr).toContain('already running');
    const exited = new Promise<number | null>((resolve) =>
      daemon.once('exit', (code) => resolve(code)),
    );
    daemon.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(existsSync(box.socket)).toBe(false);
  });

  it('exits with the error when the web port is taken', async () => {
    const box = sandbox();
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const port = String((taken.address() as AddressInfo).port);
    try {
      const result = await aip(box, 'web', '--port', port);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`127.0.0.1:${port}`);
      expect(result.stderr).toContain('already in use');
      expect(result.stderr).toContain('--port');
      expect(taken.listening).toBe(true);
    } finally {
      taken.close();
    }
  });

  it('prints the web link and exits on SIGTERM', async () => {
    const box = sandbox();
    const web = spawn(process.execPath, [main, 'web', '--port', '0'], {
      cwd: box.repo,
      env: box.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<number | null>((resolve) => web.once('exit', resolve));
    let stdout = '';
    web.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    await waitUntil('the link of aip web', () => stdout.includes('aip web: http'));
    expect(stdout).toMatch(/^aip web: http:\/\/127\.0\.0\.1:\d+\/\?token=/);
    web.kill('SIGTERM');
    expect(await exited).toBe(0);
  });

  it('uses the access token from AIP_WEB_TOKEN', async () => {
    const box = sandbox();
    const token = 'abcdefghijklmnop1234';
    const web = spawn(process.execPath, [main, 'web', '--port', '0'], {
      cwd: box.repo,
      env: { ...box.env, AIP_WEB_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<number | null>((resolve) => web.once('exit', resolve));
    let stdout = '';
    web.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    await waitUntil('the link of aip web', () => stdout.includes('aip web: http'));
    const url = /^aip web: (\S+)$/m.exec(stdout)?.[1] ?? '';
    expect(url).toMatch(new RegExp(`\\?token=${token}$`));
    const response = await fetch(new URL('/api/runs', url), { headers: { 'x-aip-token': token } });
    expect(response.status).toBe(200);
    web.kill('SIGTERM');
    expect(await exited).toBe(0);
  });

  it('rejects an invalid AIP_WEB_TOKEN', async () => {
    const box = sandbox();
    const result = await aip(
      { ...box, env: { ...box.env, AIP_WEB_TOKEN: 'short' } },
      'web',
      '--port',
      '0',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('AIP_WEB_TOKEN');
  });

  async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  function writeGlobalSettings(box: Sandbox, text: string): void {
    const directory = join(box.env.XDG_CONFIG_HOME ?? '', 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'settings.yaml'), text);
  }

  function panelFile(box: Sandbox): string {
    return join(box.state, 'web.json');
  }

  async function runWeb(
    box: Sandbox,
    args: string[],
    extra: NodeJS.ProcessEnv = {},
  ): Promise<{ child: ChildProcess; stdout: () => string; exited: Promise<number | null> }> {
    const child = spawn(process.execPath, [main, 'web', ...args], {
      cwd: box.repo,
      env: { ...box.env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    return { child, stdout: () => out, exited };
  }

  describe('aip web start|stop|restart|status', () => {
    const noAutostart = (box: Sandbox): Sandbox => {
      const env = { ...box.env };
      delete env.AIP_WEB_AUTOSTART;
      return { ...box, env };
    };
    const listening = async (port: number): Promise<boolean> =>
      fetch(`http://127.0.0.1:${port}/`).then(
        () => true,
        () => false,
      );

    it('starts, reports, stops and restarts the panel of the daemon', async () => {
      const box = sandbox();
      const port = await freePort();
      writeGlobalSettings(box, `web: { autostart: false, port: ${port} }\n`);
      const env = noAutostart(box);

      const started = await aip(env, 'web', 'start');
      expect(started.code).toBe(0);
      const pid = /^aip web: started \(pid (\d+)\)$/m.exec(started.stdout)?.[1];
      expect(pid).toBeDefined();
      const url = /^aip web: (http\S+)$/m.exec(started.stdout)?.[1] ?? '';
      expect(url).toContain(`http://127.0.0.1:${port}/?token=`);
      expect(await listening(port)).toBe(true);

      const again = await aip(env, 'web', 'start');
      expect(again.code).toBe(0);
      expect(again.stdout).toContain(`aip web: already running (pid ${pid})`);
      expect(again.stdout).toContain(url);

      const status = await aip(env, 'web', 'status');
      expect(status.code).toBe(0);
      expect(status.stdout).toContain(`aip web: running (pid ${pid})`);
      expect(status.stdout).toContain(`address: 127.0.0.1:${port}`);
      expect(status.stdout).toContain('auth: token');
      const json = JSON.parse((await aip(env, 'web', 'status', '--json')).stdout) as unknown;
      expect(json).toMatchObject({ running: true, daemon: true, port, reason: null });

      // a new port after a settings change, the token stays
      const next = await freePort();
      writeGlobalSettings(box, `web: { autostart: false, port: ${next} }\n`);
      const restarted = await aip(env, 'web', 'restart');
      expect(restarted.code).toBe(0);
      expect(restarted.stdout).toContain(`aip web: restarted (pid ${pid})`);
      const token = new URL(url).searchParams.get('token');
      expect(restarted.stdout).toContain(`http://127.0.0.1:${next}/?token=${token}`);
      expect(await listening(port)).toBe(false);
      expect(await listening(next)).toBe(true);

      const stopped = await aip(env, 'web', 'stop');
      expect(stopped.code).toBe(0);
      expect(stopped.stdout).toContain(`aip web: stopped (pid ${pid})`);
      expect(await listening(next)).toBe(false);
      expect(existsSync(panelFile(box))).toBe(false);
      const daemonStatus = await aip(env, 'daemon', 'status');
      expect(daemonStatus.stdout).toContain(`aip daemon: running (pid ${pid})`);
      const after = await aip(env, 'web', 'status');
      expect(after.code).toBe(3);
      expect(after.stdout).toContain('aip web: not running');
      expect((await aip(env, 'web', 'stop')).stdout).toContain('aip web: not running');
    });

    it('does not start the daemon for status and stop', async () => {
      const box = sandbox();
      const status = await aip(box, 'web', 'status', '--json');
      expect(status.code).toBe(3);
      expect(JSON.parse(status.stdout)).toMatchObject({
        running: false,
        daemon: false,
        pid: null,
        url: null,
      });
      expect(status.stdout.trim().split('\n')).toHaveLength(1);
      const stop = await aip(box, 'web', 'stop');
      expect(stop.code).toBe(0);
      expect(stop.stdout).toContain('aip web: not running');
      expect(existsSync(join(box.state, 'aip.pid'))).toBe(false);
    });

    it('starts the daemon for start and takes the token from AIP_WEB_TOKEN', async () => {
      const box = sandbox();
      const port = await freePort();
      writeGlobalSettings(box, `web: { port: ${port} }\n`);
      const token = 'abcdefghijklmnop1234';
      const env = noAutostart(box);
      const result = await aip(
        { ...env, env: { ...env.env, AIP_WEB_TOKEN: token } },
        'web',
        'start',
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`?token=${token}`);
      expect((await aip(env, 'daemon', 'status')).code).toBe(0);
    });

    it('fails with code 1 when the port is taken, and the daemon keeps running', async () => {
      const box = sandbox();
      const taken = createServer();
      await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
      const port = (taken.address() as AddressInfo).port;
      try {
        writeGlobalSettings(box, `web: { autostart: false, port: ${port} }\n`);
        const env = noAutostart(box);
        const result = await aip(env, 'web', 'start');
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(`127.0.0.1:${port}`);
        expect((await aip(env, 'daemon', 'status')).code).toBe(0);
        const status = await aip(env, 'web', 'status');
        expect(status.code).toBe(3);
        expect(status.stdout).toContain(`reason: port 127.0.0.1:${port} is already in use`);
        expect(taken.listening).toBe(true);
      } finally {
        taken.close();
      }
    });

    it('rejects an invalid AIP_WEB_TOKEN before it talks to the daemon', async () => {
      const box = sandbox();
      for (const sub of ['start', 'restart']) {
        const result = await aip(
          { ...box, env: { ...box.env, AIP_WEB_TOKEN: 'short' } },
          'web',
          sub,
        );
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('AIP_WEB_TOKEN');
      }
      expect(existsSync(join(box.state, 'aip.pid'))).toBe(false);
    });

    it('lets a plain `aip web` raise its own server at once after `aip web stop`', async () => {
      const box = sandbox();
      const port = await freePort();
      writeGlobalSettings(box, `web: { port: ${port} }\n`);
      const env = noAutostart(box);
      expect((await aip(env, 'web', 'start')).code).toBe(0);
      expect((await aip(env, 'web', 'stop')).code).toBe(0);
      const began = Date.now();
      const web = await runWeb(env, ['--port', String(port)]);
      await waitUntil('the link of aip web', () => web.stdout().includes('aip web: http'), 4000);
      expect(Date.now() - began).toBeLessThan(4500);
      expect(web.stdout()).not.toContain('served by the aip daemon');
      web.child.kill('SIGTERM');
      expect(await web.exited).toBe(0);
    });
  });

  it('starts the web panel with the daemon and removes its state file on shutdown', async () => {
    const box = sandbox();
    const port = await freePort();
    writeGlobalSettings(box, `web: { port: ${port} }\n`);
    const env = { ...box.env };
    delete env.AIP_WEB_AUTOSTART;
    const started = { ...box, env };
    expect((await aip(started, 'repo', 'list')).code).toBe(0);
    await waitUntil('web.json', () => existsSync(panelFile(box)));
    const state = JSON.parse(readFileSync(panelFile(box), 'utf8')) as { url: string; port: number };
    expect(state.port).toBe(port);
    expect(statSync(panelFile(box)).mode & 0o777).toBe(0o600);
    expect((await fetch(state.url)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/runs`)).status).toBe(401);

    // `aip web` reports the panel of the daemon and exits at once.
    const web = await runWeb(started, []);
    expect(await web.exited).toBe(0);
    expect(web.stdout()).toContain(`aip web: ${state.url}`);
    expect(web.stdout()).toContain('served by the aip daemon');

    // another port gets a server of its own
    const other = await runWeb(started, ['--port', '0']);
    await waitUntil('the link of the second aip web', () =>
      other.stdout().includes('aip web: http'),
    );
    expect(other.stdout()).not.toContain('served by the aip daemon');
    other.child.kill('SIGTERM');
    expect(await other.exited).toBe(0);

    await request(box.socket, 'shutdown', {});
    await waitUntil('the port to be free', async () => {
      try {
        await fetch(state.url);
        return false;
      } catch {
        return true;
      }
    });
    await waitUntil('web.json to be removed', () => !existsSync(panelFile(box)));
  });

  it('keeps the daemon working when the panel port is taken', async () => {
    const box = sandbox();
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const port = (taken.address() as AddressInfo).port;
    try {
      writeGlobalSettings(box, `web: { port: ${port} }\n`);
      const env = { ...box.env };
      delete env.AIP_WEB_AUTOSTART;
      expect((await aip({ ...box, env }, 'repo', 'list')).code).toBe(0);
      await waitUntil('the daemon log to name the port', () => {
        const log = join(box.state, 'daemon.log');
        return existsSync(log) && readFileSync(log, 'utf8').includes(`127.0.0.1:${port}`);
      });
      expect(readFileSync(join(box.state, 'daemon.log'), 'utf8')).toContain(
        'web panel not started',
      );
      expect(existsSync(panelFile(box))).toBe(false);
      expect((await aip({ ...box, env }, 'repo', 'list')).code).toBe(0);
    } finally {
      taken.close();
    }
  });

  it('prints a link without a token when web.auth is none', async () => {
    const box = sandbox();
    writeGlobalSettings(box, 'web: { autostart: false, auth: none }\n');
    const web = await runWeb(box, ['--port', '0'], { AIP_WEB_TOKEN: 'abcdefghijklmnop1234' });
    await waitUntil('the link of aip web', () => web.stdout().includes('aip web: http'));
    const url = /^aip web: (\S+)$/m.exec(web.stdout())?.[1] ?? '';
    expect(url).not.toContain('token=');
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(page.headers.get('set-cookie')).toBeNull();
    expect((await fetch(new URL('/api/runs', url))).status).toBe(200);
    web.child.kill('SIGTERM');
    expect(await web.exited).toBe(0);
  });

  it('takes the port of aip web from the settings', async () => {
    const box = sandbox();
    const port = await freePort();
    writeGlobalSettings(box, `web: { autostart: false, port: ${port} }\n`);
    const web = await runWeb(box, []);
    await waitUntil('the link of aip web', () => web.stdout().includes('aip web: http'));
    expect(web.stdout()).toContain(`aip web: http://127.0.0.1:${port}/`);
    web.child.kill('SIGTERM');
    expect(await web.exited).toBe(0);
  });

  it('fails aip web on a wrong web section with the field path', async () => {
    const box = sandbox();
    writeGlobalSettings(box, 'web: { host: 0.0.0.0 }\n');
    const result = await aip(box, 'web', '--port', '0');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('swarm.web.host');
  });

  it('describes the access mode and the daemon panel in `web --help`', async () => {
    const help = await aip(sandbox(), 'web', '--help');
    expect(help.stdout).toContain('unless web.auth is none');
    expect(help.stdout).toContain('web.port');
    expect(help.stdout).toContain('The daemon serves the dashboard itself');
  });

  describe('aip web repository scope', () => {
    async function webQueue(
      box: Sandbox,
      cwd: string,
    ): Promise<{ status: number; body: { repository?: string }; stderr: string }> {
      const child = spawn(process.execPath, [main, 'web', '--port', '0'], {
        cwd,
        env: { ...box.env, AIP_WEB_TOKEN: 'abcdefghijklmnop1234' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        err += chunk.toString();
      });
      try {
        await waitUntil('the link of aip web', () => out.includes('aip web: http'));
        const url = /^aip web: (\S+)$/m.exec(out)?.[1] ?? '';
        const response = await fetch(new URL('/api/queue', url), {
          headers: { 'x-aip-token': 'abcdefghijklmnop1234' },
        });
        return { status: response.status, body: (await response.json()) as never, stderr: err };
      } finally {
        child.kill('SIGTERM');
        await exited;
      }
    }

    function outsideGit(): string {
      return realpathSync(mkdtempSync(join(tmpdir(), 'aip-outside-')));
    }

    /** Two registered repositories: the sandbox one, then `second`, added last. */
    async function twoRegistered(box: Sandbox): Promise<string> {
      expect((await aip(box, 'repo', 'add', box.repo)).code).toBe(0);
      const second = realpathSync(mkdtempSync(join(tmpdir(), 'aip-second-')));
      execFileSync('git', ['init', '-q', '-b', 'main', second]);
      expect((await aip(box, 'repo', 'add', second)).code).toBe(0);
      return second;
    }

    it('ignores the git repository it runs in and answers with the repository added last', async () => {
      const box = sandbox();
      const second = await twoRegistered(box);
      const other = realpathSync(mkdtempSync(join(tmpdir(), 'aip-other-')));
      execFileSync('git', ['init', '-q', '-b', 'main', other]);
      mkdirSync(join(other, 'sub'));
      const result = await webQueue(box, join(other, 'sub'));
      expect(result.status).toBe(200);
      expect(result.body.repository).toBe(second);
      const list = await aip(box, 'repo', 'list', '--json');
      expect((JSON.parse(list.stdout) as { path: string }[]).map((entry) => entry.path)).toEqual([
        box.repo,
        second,
      ]);
    });

    it('answers with the repository added last outside git without a warning', async () => {
      const box = sandbox();
      const second = await twoRegistered(box);
      const result = await webQueue(box, outsideGit());
      expect(result.status).toBe(200);
      expect(result.body.repository).toBe(second);
      expect(result.stderr).not.toContain('is not inside a git repository');
    });

    it('answers 409 while the registry is empty, even inside a git repository', async () => {
      const box = sandbox();
      expect((await webQueue(box, outsideGit())).status).toBe(409);
      expect((await webQueue(box, box.repo)).status).toBe(409);
    });
  });

  it('adds a repository by a subdirectory, lists it and refuses a path outside git', async () => {
    const box = sandbox();
    mkdirSync(join(box.repo, 'sub'));
    const added = await aip(box, 'repo', 'add', join(box.repo, 'sub'));
    expect(added.code).toBe(0);
    const list = await aip(box, 'repo', 'list', '--json');
    expect(JSON.parse(list.stdout)).toEqual([
      { path: box.repo, addedAt: expect.any(Number), unfinished: 0, waiting: 0, queued: 0 },
    ]);
    const text = await aip(box, 'repo', 'list');
    expect(text.stdout).toContain('REPOSITORY');
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'aip-outside-')));
    const refused = await aip(box, 'repo', 'add', outside);
    expect(refused.code).toBe(1);
    expect(refused.stderr).not.toBe('');
    const removed = await aip(box, 'repo', 'remove', box.repo, '--json');
    expect(removed.code).toBe(0);
    expect(JSON.parse(removed.stdout)).toEqual([]);
  });

  it('does not start the daemon or touch the list for aip config check', async () => {
    const box = sandbox();
    const checked = await aip(box, 'config', 'check');
    expect(checked.code).toBe(0);
    expect(existsSync(box.socket)).toBe(false);
    const list = await aip(box, 'repo', 'list', '--json');
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  it('creates, lists, edits and removes tags', async () => {
    const box = sandbox();
    expect((await aip(box, 'tag', 'list')).stdout).toContain('No tags yet.');
    const added = await aip(box, 'tag', 'add', 'auth', '--color', 'blue');
    expect(added.code).toBe(0);
    const list = await aip(box, 'tag', 'list');
    expect(list.stdout).toMatch(/auth\s+blue/);
    const bad = await aip(box, 'tag', 'add', 'other', '--color', 'cyan');
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain('gray, red, orange');
    expect((await aip(box, 'tag', 'add', 'AUTH')).stderr).toContain('tag `auth` already exists');
    const none = await aip(box, 'tag', 'edit', 'auth');
    expect(none.code).not.toBe(0);
    const edited = await aip(box, 'tag', 'edit', 'auth', '--name', 'login', '--color', 'teal');
    expect(edited.stdout).toMatch(/login\s+teal/);
    const json = JSON.parse((await aip(box, 'tag', 'list', '--json')).stdout) as {
      name: string;
    }[];
    expect(json.map((tag) => tag.name)).toEqual(['login']);
    const removed = await aip(box, 'tag', 'remove', 'login');
    expect(removed.stdout).toContain('No tags yet.');
    expect((await aip(box, 'tag', '--help')).stdout.replace(/\s+/g, ' ')).toContain(
      'gray, red, orange, yellow, green, teal, blue, violet, pink, brown',
    );
  });

  it('puts tags on queued tasks and edits them', async () => {
    const box = sandbox();
    await aip(box, 'tag', 'add', 'auth');
    await aip(box, 'tag', 'add', 'v2');
    const added = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'Форма входа',
      '--tag',
      'auth',
      '--tag',
      'v2',
    );
    expect(added.code).toBe(0);
    expect((await aip(box, 'queue', 'list')).stdout).toContain('#auth #v2');
    const view = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
      items: { id: string; tags: { name: string }[] }[];
    };
    expect(view.items[0]!.tags.map((tag) => tag.name)).toEqual(['auth', 'v2']);
    const id = view.items[0]!.id;
    const both = await aip(box, 'queue', 'edit', id, '--tag', 'auth', '--no-tags');
    expect(both.code).not.toBe(0);
    expect((await aip(box, 'queue', 'edit', id, '--task', 'другое')).stdout).toContain('#auth #v2');
    const replaced = await aip(box, 'queue', 'edit', id, '--tag', 'v2');
    expect(replaced.stdout).toContain('#v2');
    expect(replaced.stdout).not.toContain('#auth');
    const cleared = await aip(box, 'queue', 'edit', id, '--no-tags', '--json');
    expect((JSON.parse(cleared.stdout) as typeof view).items[0]!.tags).toEqual([]);
    const unknown = await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--tag', 'nope');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('aip tag add nope');
    expect(
      (JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as typeof view).items,
    ).toHaveLength(1);
  });

  it('skips steps of queued tasks and edits the list', async () => {
    const box = sandbox();
    const added = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'Форма входа',
      '--skip',
      'review',
      '--json',
    );
    expect(added.code).toBe(0);
    const view = JSON.parse(added.stdout) as { items: { id: string; skip: string[] }[] };
    expect(view.items[0]!.skip).toEqual(['review']);
    const id = view.items[0]!.id;
    expect((await aip(box, 'queue', 'list')).stdout).toContain('skip: review');
    const both = await aip(box, 'queue', 'edit', id, '--skip', 'review', '--no-skips');
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--no-skips cannot be combined with --skip');
    expect((await aip(box, 'queue', 'edit', id, '--task', 'другое')).stdout).toContain(
      'skip: review',
    );
    const cleared = await aip(box, 'queue', 'edit', id, '--no-skips', '--json');
    expect((JSON.parse(cleared.stdout) as typeof view).items[0]!.skip).toEqual([]);
    const unknown = await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--skip', 'deploy');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('unknown step `deploy` in skip');
    const accepted = await aip(
      box,
      'run',
      'start',
      'feature',
      '--task',
      'z',
      '--skip',
      'review',
      '--json',
    );
    expect(accepted.code).toBe(0);
    const started = await aip(box, 'run', 'start', 'feature', '--task', 'y', '--skip', 'nope');
    expect(started.code).not.toBe(0);
    expect(started.stderr).toContain('unknown step `nope` in skip');
  });

  it('postpones queued tasks and takes them back, and refuses the flag on `run start`', async () => {
    const box = sandbox();
    const added = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'later', '--postpone', '--json')).stdout,
    ) as { item: string; items: { id: string; postponed: boolean }[] };
    expect(added.items.find((item) => item.id === added.item)!.postponed).toBe(true);
    expect((await aip(box, 'queue', 'list')).stdout).toContain('· postponed');
    const cleared = JSON.parse(
      (await aip(box, 'queue', 'edit', added.item, '--no-postpone', '--json')).stdout,
    ) as typeof added;
    expect(cleared.items[0]!.postponed).toBe(false);
    expect((await aip(box, 'queue', 'list')).stdout).not.toContain('postponed');
    const again = JSON.parse(
      (await aip(box, 'queue', 'edit', added.item, '--postpone', '--json')).stdout,
    ) as typeof added;
    expect(again.items[0]!.postponed).toBe(true);
    const start = await aip(box, 'run', 'start', 'feature', '--task', 'x', '--postpone');
    expect(start.code).not.toBe(0);
    expect(start.stderr).toContain('unknown option');
  });

  it('queues a task after another one, clears the dependencies and refuses both flags', async () => {
    const box = sandbox();
    const first = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'модель', '--json')).stdout,
    ) as { item: string };
    const added = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'API',
      '--after',
      first.item,
      '--json',
    );
    expect(added.code).toBe(0);
    const view = JSON.parse(added.stdout) as {
      item: string;
      items: { id: string; readiness: string; after: { id: string; state: string }[] }[];
    };
    const second = view.items.find((item) => item.id === view.item)!;
    expect(second).toMatchObject({ readiness: 'waiting' });
    expect(second.after).toMatchObject([{ id: first.item, state: 'waiting' }]);
    expect((await aip(box, 'queue', 'list')).stdout).toContain(`after ${first.item} (waiting)`);
    const both = await aip(box, 'queue', 'edit', view.item, '--after', first.item, '--no-after');
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('--no-after cannot be combined with --after');
    expect((await aip(box, 'queue', 'list')).stdout).toContain(`after ${first.item}`);
    const cleared = await aip(box, 'queue', 'edit', view.item, '--no-after', '--json');
    expect(cleared.code).toBe(0);
    expect(
      (JSON.parse(cleared.stdout) as typeof view).items.find((item) => item.id === view.item)!
        .after,
    ).toEqual([]);
    const cycle = await aip(box, 'queue', 'edit', first.item, '--after', view.item);
    expect(cycle.code).toBe(0);
    const closing = await aip(box, 'queue', 'edit', view.item, '--after', first.item);
    expect(closing.code).not.toBe(0);
    expect(closing.stderr).toContain('dependency cycle');
    const unknown = await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--after', 'nope');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('unknown dependency `nope`');
  });

  it('queues run start with an unfinished dependency instead of creating a run', async () => {
    const box = sandbox();
    const first = JSON.parse(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'модель', '--json')).stdout,
    ) as { item: string };
    const started = await aip(
      box,
      'run',
      'start',
      'feature',
      '--task',
      'API',
      '--after',
      first.item,
      '--json',
    );
    expect(started.code).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({ run: null });
    const text = await aip(box, 'run', 'start', 'feature', '--task', 'UI', '--after', first.item);
    expect(text.stdout).toMatch(/Task \S+ queued at position/);
  });

  it('removes a tag from a queued task', async () => {
    const box = sandbox();
    await aip(box, 'tag', 'add', 'auth');
    await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--tag', 'auth');
    await aip(box, 'tag', 'remove', 'auth');
    const list = await aip(box, 'queue', 'list');
    expect(list.stdout).not.toContain('#auth');
    expect(list.stdout).toContain('x');
  });

  it('tags and untags runs and filters the list by any of the tags', async () => {
    const box = sandbox();
    await aip(box, 'tag', 'add', 'auth');
    await aip(box, 'tag', 'add', 'v2');
    const started = async (title: string, ...tags: string[]) => {
      const queued = JSON.parse(
        (
          await aip(
            box,
            'run',
            'start',
            'feature',
            '--task',
            title,
            '--title',
            title,
            '--json',
            ...tags.flatMap((tag) => ['--tag', tag]),
          )
        ).stdout,
      ) as { run: { runId: string } | null };
      return queued.run!.runId;
    };
    const a = await started('first', 'auth');
    await waitUntil('first run is finished', async () => {
      const runs = JSON.parse((await aip(box, 'run', 'list', '--json')).stdout) as {
        id: string;
        finished: boolean;
      }[];
      return runs.find((run) => run.id === a)?.finished === true;
    });
    const b = await started('second');
    await waitUntil('second run is finished', async () => {
      const runs = JSON.parse((await aip(box, 'run', 'list', '--json')).stdout) as {
        id: string;
        finished: boolean;
      }[];
      return runs.find((run) => run.id === b)?.finished === true;
    });
    const tagged = await aip(box, 'run', 'tag', b, 'v2');
    expect(tagged.code).toBe(0);
    expect(tagged.stdout).toContain('#v2');
    expect((await aip(box, 'run', 'show', b)).stdout).toContain('#v2');
    const c = await started('third');
    await waitUntil('third run is finished', async () => {
      const runs = JSON.parse((await aip(box, 'run', 'list', '--json')).stdout) as {
        id: string;
        finished: boolean;
      }[];
      return runs.find((run) => run.id === c)?.finished === true;
    });
    const filtered = await aip(box, 'run', 'list', '--tag', 'AUTH', '--tag', 'v2');
    expect(filtered.stdout).toContain(a);
    expect(filtered.stdout).toContain(b);
    expect(filtered.stdout).not.toContain(c);
    expect(filtered.stdout).toContain('#auth');
    const one = JSON.parse((await aip(box, 'run', 'list', '--tag', 'v2', '--json')).stdout) as {
      id: string;
    }[];
    expect(one.map((run) => run.id)).toEqual([b]);
    const untagged = await aip(box, 'run', 'untag', b, 'v2');
    expect(untagged.stdout).toContain('none');
    await aip(box, 'tag', 'add', 'idle');
    const empty = await aip(box, 'run', 'list', '--tag', 'idle');
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain('No runs with these tags.');
    const unknown = await aip(box, 'run', 'tag', b, 'nope');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('unknown tag `nope`');
  }, 120_000);
});
