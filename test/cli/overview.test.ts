import { writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { aip, aipProcess, runOf, sandbox, waitUntil } from './sandbox.ts';

interface Json {
  daemon: { pid: number | null; panel: string | null };
  attention: { kind: string; runId: string | null; group: string | null }[];
  projects: unknown[];
  runs: { id: string }[];
}

describe('aip overview', () => {
  it('is quiet for an idle swarm', async () => {
    const box = sandbox();
    const text = await aip(box, 'overview');
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('Needs you: nothing');
    expect(text.stdout).toContain('Projects: idle');
    expect(text.stdout).toContain('Runs: none active');
    const json = JSON.parse((await aip(box, 'overview', '--json')).stdout) as Json;
    expect(json).toMatchObject({ attention: [], projects: [], runs: [] });
  });

  it('shows the run and its question, in text and in JSON', async () => {
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
    const text = (await aip(box, 'overview')).stdout;
    expect(text).toMatch(/^aip \S+ · daemon pid \d+ · (busy|idle)/);
    expect(text).toContain('Needs you (1):');
    expect(text).toContain(`${runId} vhod  question: Какой вход?`);
    expect(text).toContain('Projects:');
    expect(text).toContain('Runs:');
    expect(text).not.toContain('→ ');
    const json = JSON.parse((await aip(box, 'overview', '--json')).stdout) as Json;
    expect(json.attention[0]).toMatchObject({ kind: 'question', runId, group: 'vhod' });
    expect(json.runs.map((run) => run.id)).toEqual([runId]);
    expect(json.projects).toHaveLength(1);
    await aip(box, 'run', 'cancel', runId);
  });

  it('refuses --watch with --json before asking the daemon', async () => {
    const box = sandbox();
    const result = await aipProcess(box, 'overview', '--watch', '--json');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--watch');
    expect((await aipProcess(box, 'daemon', 'status')).code).toBe(3);
  });
});
