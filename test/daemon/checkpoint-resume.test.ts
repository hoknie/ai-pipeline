import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_ONLY_CONFIG, PIPELINE_CONFIG } from './harness.ts';
import { calls, run, start, until } from './control-harness.ts';

const config = CODE_ONLY_CONFIG.replace(
  'coder: { name: Coder }',
  'coder: { name: Coder, runtime: opencode, model: test/model }',
);

describe('checkpoint recovery', () => {
  it('delivers full structured findings in an ordinary on_reject cycle', async () => {
    const h = await start(
      PIPELINE_CONFIG.replace(
        'coder: { name: Coder }',
        'coder: { name: Coder, runtime: opencode, model: test/model }',
      ),
    );
    h.script({
      code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }, {}],
      review: [
        {
          verdict: 'rejected',
          summary: 'Found R1',
          feedback: 'Fix R1',
          review: {
            findings: [
              {
                id: 'R1',
                severity: 'major',
                file: 'lib.ts:1',
                scenario: 'null input',
                expected: 'preserve null',
                evidence: 'drops key',
                origin: 'initial',
                reason: 'task requirement',
              },
            ],
            resolved: [],
          },
        },
        {},
      ],
    });
    const id = await run(h);
    await h.waitFor(id, (view) => view.finished);
    const prompt = calls(h)
      .filter((call) => call.step === 'code')[1]!
      .args.at(-1)!;
    expect(prompt).toContain('[R1] major: lib.ts:1');
    expect(prompt).toContain('Expected: preserve null');
    expect(prompt).toContain('Evidence: drops key');
  });

  it('restores the newest checkpoint after a failed attempt and daemon restart, without ending the step', async () => {
    const h = await start(config);
    h.script({
      code: [
        {
          noReport: true,
          toolCalls: [
            {
              name: 'swarm_artifact',
              arguments: { file_name: 'checkpoint.md', content: 'obsolete' },
            },
            {
              name: 'swarm_artifact',
              arguments: {
                file_name: 'checkpoint.md',
                content: 'Checked lib.ts; next: add regression test.',
              },
            },
          ],
        },
        { write: { 'lib.ts': 'export const changed = true;\n' } },
      ],
    });
    const id = await run(h);
    await h.waitFor(id, (view) => view.groups[0]?.status === 'failed');
    const artifacts = h.running.application.services.artifacts;
    const query = { runId: id, group: 'g1', step: 'code', specialist: 'coder', beforeSeq: 2 };
    expect(await artifacts.checkpoint(query)).toEqual({
      seq: 1,
      text: 'Checked lib.ts; next: add regression test.',
    });
    expect(await artifacts.checkpoint({ ...query, group: 'foreign' })).toBeNull();
    expect(await artifacts.checkpoint({ ...query, step: 'review' })).toBeNull();
    expect(await artifacts.checkpoint({ ...query, specialist: 'other' })).toBeNull();
    expect(await artifacts.checkpoint({ ...query, beforeSeq: 1 })).toBeNull();
    await h.restart();
    await h.call('retry', { runId: id, group: 'g1' });
    await h.waitFor(id, (view) => view.finished);
    const prompt = calls(h)[1]!.args.at(-1)!;
    expect(prompt).toContain('Saved progress from attempt 1 (advisory)');
    expect(prompt).toContain('Checked lib.ts; next: add regression test.');
    expect(prompt).not.toContain('obsolete');
    expect(prompt).toContain('accepted human decisions take precedence');
    // Checkpoint bytes remain in artifact storage, not in the saved step input or delivered patch.
    expect(
      h.running.application.services.runs.states.get(id).groups[0]?.attempts[1]?.input.checkpoint,
    ).toBeUndefined();
    const patch = (await h.call('run_patch', { runId: id })) as { base64: string };
    expect(Buffer.from(patch.base64, 'base64').toString()).not.toContain('Checked lib.ts');
  });

  it('persists OpenCode session before process exit and keeps it through a daemon restart', async () => {
    const h = await start(config);
    h.script({ code: [{ usage: [{ input: 1, output: 1 }], waitFor: h.gate('finish') }] });
    const id = await run(h);
    await until('early session in database', () => {
      const row = h.running.application.database
        .prepare('SELECT session_id FROM attempts WHERE run_id = ? AND group_slug = ? AND seq = 1')
        .get(id, 'g1') as { session_id: string | null } | undefined;
      return Boolean(row?.session_id);
    });
    const state = h.running.application.services.runs.states.get(id);
    const first = state.groups[0]!.attempts[0]!;
    expect(first.status).toBe('running');
    const session = first.sessionId;
    expect(session).toBeTruthy();
    await h.restart();
    expect(
      h.running.application.services.runs.states.get(id).groups[0]?.attempts[0]?.sessionId,
    ).toBe(session);
  });

  it('rejects oversized checkpoints and tolerates unavailable checkpoint storage', async () => {
    const h = await start(config);
    h.script({
      code: [
        {
          toolCalls: [
            {
              name: 'swarm_artifact',
              arguments: { file_name: 'checkpoint.md', content: 'x'.repeat(12001) },
            },
            { name: 'swarm_artifact', arguments: { file_name: 'checkpoint.md', content: 'valid' } },
          ],
        },
      ],
    });
    const id = await run(h);
    await h.waitFor(id, (view) => view.finished);
    const results = readFileSync(join(h.fakeState, 'tools.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(results[0].result.isError).toBe(true);
    expect(results[0].result.content[0].text).toContain('12000 characters');
    h.running.application.database.prepare("UPDATE artifacts SET uri = 'unknown://gone'").run();
    expect(
      await h.running.application.services.artifacts.checkpoint({
        runId: id,
        group: 'g1',
        step: 'code',
        specialist: 'coder',
        beforeSeq: 2,
      }),
    ).toBeNull();
  });
});
