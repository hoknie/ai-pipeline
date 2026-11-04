import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { request } from '../../src/protocol/index.ts';
import { MANUAL_CONFIG, WORKFLOW_CONFIG } from '../daemon/harness.ts';
import { aip, fakes, main, ownDaemon, root, runOf, sandbox, waitUntil } from './sandbox.ts';

describe('cli', () => {
  it('delivers with aip run apply', async () => {
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
  });

  it('refuses a conflicting aip run apply with exit code 1 and forces with markers', async () => {
    const box = sandbox(MANUAL_CONFIG);
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
    await ownDaemon(box);
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
    await ownDaemon(box);
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

  it('shows runtimes and finds the command of the settings in config check', async () => {
    const box = sandbox();
    box.env.AIP_CLAUDE_BIN = '';
    const directory = join(box.env.XDG_CONFIG_HOME!, 'aip');
    mkdirSync(directory, { recursive: true });
    const command = join(fakes, 'claude');
    writeFileSync(
      join(directory, 'settings.yaml'),
      `runtimes:\n  claude:\n    command: ${command}\n    args: [--debug]\n`,
    );
    const result = await aip(box, 'config', 'check');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`command: ${command}`);
    expect(result.stdout).toContain('- --debug');
    expect(result.stdout).toContain(`claude: fake claude 0.0.0 (${command})`);
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
});
