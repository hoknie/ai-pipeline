import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { request } from '../../src/presentation/ipc/client/index.ts';
import { PIPELINE_CONFIG } from '../daemon/harness.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';
import { aip, runOf, sandbox, waitUntil } from './sandbox.ts';

interface QueueJson {
  runs: { system?: { kind: string; status: string; title?: string }[] }[];
}

const goDirectory = mkdtempSync(join(tmpdir(), 'aip-go-'));
const box0 = () => goDirectory;

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
    expect(status.stdout).toMatch(/dobavit-login\s+merged\s+Ревьюер/);
    const group = await aip(box, 'group', 'show', runId, 'dobavit-login', '--tail', '5');
    expect(group.stdout).toContain('#2 Ревьюер r1');
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
      'unknown pipeline `nope`; known: feature',
    );
  });

  it('retries with the current specialists after --refresh-config', async () => {
    const typo = PIPELINE_CONFIG.replace(
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
    writeConfigDirectory(box.repo, PIPELINE_CONFIG.replace('max: 3', 'max: 100'));
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
    expect(skipped.stdout).toContain('Skipped steps: Ревьюер (review)');
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
      PIPELINE_CONFIG.replace(
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

  it('prints the actions and the pipeline points in aip config check', async () => {
    const box = sandbox(
      PIPELINE_CONFIG.replace(
        '  pipelines:',
        `  actions:
    lint: { run: "npm run lint", timeout: 600 }
  stages:
    before_delivery: [lint]
  pipelines:`,
      ),
    );
    const result = await aip(box, 'config', 'check');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('actions:');
    expect(result.stdout).toMatch(
      /lint:\n\s+run: npm run lint\n\s+timeout: 600\n\s+on_failure: stop/,
    );
    expect(result.stdout).toMatch(/stages:\n\s+before_delivery:\n\s+- lint/);
  });

  it('prints a multi-line script of an action as a string in aip config check', async () => {
    const box = sandbox(
      PIPELINE_CONFIG.replace(
        '  pipelines:',
        `  actions:
    lint:
      run: |
        npm run lint
        npm test
  stages:
    before_delivery: [lint]
  pipelines:`,
      ),
    );
    const result = await aip(box, 'config', 'check');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/lint:\n\s+run: \|\n\s+npm run lint\n\s+npm test\n\s+timeout/);
  });

  it('rejects a list in `run` with the path of the field', async () => {
    const box = sandbox(
      PIPELINE_CONFIG.replace(
        '  pipelines:',
        `  actions:
    lint: { run: ["npm run lint", "npm test"] }
  pipelines:`,
      ),
    );
    const result = await aip(box, 'config', 'check');
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('swarm.actions.lint.run');
  });

  it('shows the action of a run in aip run show', async () => {
    const box = sandbox(
      PIPELINE_CONFIG.replace(
        '  pipelines:',
        `  actions:
    lint: { run: "true" }
  stages:
    before_delivery: [lint]
  pipelines:`,
      ),
    );
    const started = await aip(box, 'run', 'start', 'feature', '--task', 'Добавить логин', '--json');
    const { runId } = runOf(started.stdout);
    await aip(box, 'run', 'watch', runId);
    const shown = await aip(box, 'run', 'show', runId);
    expect(shown.stdout).toContain('before_delivery:lint');
    const json = JSON.parse((await aip(box, 'run', 'show', runId, '--json')).stdout) as {
      system: { kind: string; point: string | null; status: string }[];
      groups: { slug: string }[];
    };
    expect(json.system).toContainEqual(
      expect.objectContaining({ kind: 'action', point: 'before_delivery', status: 'done' }),
    );
    expect(json.groups.map((group) => group.slug).every((slug) => !slug.startsWith('_'))).toBe(
      true,
    );
  });

  it('shows a running action in aip queue list', async () => {
    const box = sandbox(
      PIPELINE_CONFIG.replace(
        '  pipelines:',
        `  actions:
    wait: { run: "while [ ! -f ${join(box0(), 'go')} ]; do sleep 0.05; done" }
  stages:
    before_delivery: [wait]
  pipelines:`,
      ),
    );
    const started = await aip(box, 'run', 'start', 'feature', '--task', 'Добавить логин', '--json');
    const { runId } = runOf(started.stdout);
    await waitUntil('the running action', async () => {
      const json = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as QueueJson;
      return json.runs.some((run) => run.system?.some((row) => row.status === 'running'));
    });
    const json = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as QueueJson;
    const row = json.runs.flatMap((run) => run.system ?? []).find((step) => step.kind === 'action');
    expect(row).toMatchObject({ kind: 'action', status: 'running', title: 'wait' });
    expect((await aip(box, 'queue', 'list')).stdout).toContain('wait');
    writeFileSync(join(goDirectory, 'go'), '');
    await aip(box, 'run', 'watch', runId);
  });
});
