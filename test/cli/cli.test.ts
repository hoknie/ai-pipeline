import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { request } from '../../src/protocol/index.ts';
import { WORKFLOW_CONFIG } from '../daemon/harness.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';
import { aip, runOf, sandbox, waitUntil } from './sandbox.ts';

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
    const runId = /Run #\d+ (\w+) started/.exec(started.stdout)?.[1] ?? '';
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

  it('retries with the current specialists after --refresh-config', async () => {
    const typo = WORKFLOW_CONFIG.replace(
      'reviewer: { name: Ревьюер, permissions: read }',
      'reviewer: { name: Ревьюер, permissions: read, model: opsu }',
    );
    const box = sandbox(typo);
    writeFileSync(
      box.env.AIP_FAKE_SCRIPT!,
      JSON.stringify({ review: [{ exitCode: 1, noReport: true }, {}] }),
    );
    const { runId } = runOf(
      (await aip(box, 'run', 'start', 'feature', '--task', 'вход', '--json')).stdout,
    );
    await waitUntil('the failed review', async () =>
      (await aip(box, 'run', 'show', runId)).stdout.includes('failed'),
    );
    writeConfigDirectory(box.repo, WORKFLOW_CONFIG.replace('max: 3', 'max: 100'));
    const broken = await aip(box, 'group', 'retry', runId, 'vhod', '--refresh-config');
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain('configuration not loaded: swarm.max');
    writeConfigDirectory(box.repo, typo.replace('model: opsu', 'model: opus'));
    const retried = await aip(box, 'group', 'retry', runId, 'vhod', '--refresh-config');
    expect(retried.code).toBe(0);
    await aip(box, 'run', 'watch', runId);
    const group = await aip(box, 'group', 'show', runId, 'vhod', '--json');
    expect(JSON.parse(group.stdout).warnings).toContain(
      'config refreshed: reviewer model opsu → opus',
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

  it('skips a step of a running run, brings it back with --off and refuses a passed step', async () => {
    const box = sandbox();
    writeFileSync(box.env.AIP_FAKE_SCRIPT!, JSON.stringify({ code: [{ hang: true }] }));
    const { runId } = runOf(
      (await aip(box, 'run', 'start', 'feature', '--task', 'x', '--json')).stdout,
    );
    const skipped = await aip(box, 'run', 'skip', runId, 'review');
    expect(skipped.code).toBe(0);
    expect(skipped.stdout).toContain('Skipped steps: review');
    const back = await aip(box, 'run', 'skip', runId, 'review', '--off', '--json');
    const view = JSON.parse(back.stdout) as { steps: { id: string; skipped: boolean }[] };
    expect(view.steps.find((entry) => entry.id === 'review')?.skipped).toBe(false);
    const unknown = await aip(box, 'run', 'skip', runId, 'nope');
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('unknown step');
    await aip(box, 'run', 'cancel', runId);
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
});
