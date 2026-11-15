import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PIPELINE_CONFIG, statuses } from './harness.ts';
import { calls, run, start, until } from './control-harness.ts';

const CONFIG = `${PIPELINE_CONFIG.replace(
  'coder: { name: Кодировщик }',
  'coder: { name: Кодировщик, runtime: claude, model: sonnet }',
)}      variants:
        strong:
          name: Сильный
          steps:
            code: { model: opus }
`;

function models(h: Parameters<typeof calls>[0]): (string | undefined)[] {
  return calls(h).map((call) => call.args[call.args.indexOf('--model') + 1]);
}

describe('switching the variant of a running run', () => {
  it('stops the running step and starts it again with the model of the variant', async () => {
    const h = await start(CONFIG);
    h.script({ code: [{ hang: true }, {}] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    // the agent process runs: its call is logged, so the script goes on to the next entry
    await until('the agent started', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    const switched = (await h.call('run_variant', { runId, variant: 'strong' })) as {
      variant: string;
      variantName: string;
    };
    expect(switched).toMatchObject({ variant: 'strong', variantName: 'Сильный' });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    expect(final).toMatchObject({ variant: 'strong', variantName: 'Сильный' });
    const group = await h.group(runId, 'g1');
    const code = group.attempts.filter((attempt) => attempt.stepId === 'code');
    expect(code[0]).toMatchObject({ status: 'cancelled' });
    expect(code[0]?.reason).toContain('variant changed: default → strong');
    expect(code[1]).toMatchObject({ model: 'opus' });
    expect(models(h).slice(0, 2)).toEqual(['sonnet', 'opus']);
  });

  it('keeps the variant after a restart of the daemon', async () => {
    const h = await start(CONFIG);
    h.script({ code: [{ hang: true }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await h.call('run_variant', { runId, variant: 'strong' });
    await h.restart();
    expect((await h.status(runId)).variant).toBe('strong');
  });

  it('refuses an unknown variant and changes nothing', async () => {
    const h = await start(CONFIG);
    h.script({ code: [{ hang: true }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await expect(h.call('run_variant', { runId, variant: 'fast' })).rejects.toThrow(
      'unknown variant `fast` of pipeline `feature`; known: default, strong',
    );
    const view = await h.status(runId);
    expect(view.variant).toBe('default');
    expect(view.groups[0]?.status).toBe('running');
  });

  it('refuses a finished run', async () => {
    const h = await start(CONFIG);
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    await expect(h.call('run_variant', { runId, variant: 'strong' })).rejects.toThrow(
      'is finished',
    );
  });
});
