import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { statuses } from './harness.ts';
import { calls, run, start, until } from './control-harness.ts';

const CONFIG = `swarm:
  max: 3
  chains:
    coding:
      name: Coding
      mode: by_provider
      runtimes:
        - { provider: anthropic, runtime: claude, model: opus }
        - { provider: zai, runtime: claude, model: sonnet }
        - { provider: openai, runtime: claude, model: haiku }
  specialists:
    coder: { name: Coder, runtime_chain: coding }
    reviewer: { name: Reviewer, permissions: read }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 } }
`;

function models(h: Parameters<typeof calls>[0]): (string | undefined)[] {
  return calls(h).map((call) => call.args[call.args.indexOf('--model') + 1]);
}

async function runWith(h: Awaited<ReturnType<typeof start>>, provider?: string): Promise<string> {
  const groups = [{ title: 'g1', task: 'task 1' }];
  const queued = (await h.call('run', {
    repository: h.repo,
    pipeline: 'feature',
    groups,
    ...(provider ? { provider } : {}),
  })) as { run?: { runId: string } };
  return queued.run!.runId;
}

describe('switching the provider of a running run', () => {
  it('stops the running step, keeps its edits and starts it again on the new provider', async () => {
    const h = await start(CONFIG);
    h.script({ code: [{ write: { 'partial.txt': 'half' }, hang: true }, {}] });
    const runId = await runWith(h, 'zai');
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await until('the agent started', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    const switched = (await h.call('run_provider', { runId, provider: 'openai' })) as {
      provider: string;
    };
    expect(switched.provider).toBe('openai');
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    expect(final.provider).toBe('openai');
    const group = await h.group(runId, 'g1');
    const code = group.attempts.filter((attempt) => attempt.stepId === 'code');
    expect(code[0]).toMatchObject({ status: 'cancelled' });
    expect(code[0]?.reason).toContain('provider changed: zai → openai');
    expect(code[1]).toMatchObject({ provider: 'openai' });
    expect(models(h).slice(0, 2)).toEqual(['sonnet', 'haiku']);
    // the edits of the stopped attempt stay in the working copy of the group
    const patch = (await h.call('run_patch', { runId })) as { base64: string };
    expect(Buffer.from(patch.base64, 'base64').toString()).toContain('partial.txt');
  });

  it('resets the provider without stopping the running step', async () => {
    const h = await start(CONFIG);
    h.script({ code: [{ delayMs: 300 }, {}] });
    const runId = await runWith(h, 'zai');
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    const reset = (await h.call('run_provider', { runId, provider: null })) as {
      provider: string | null;
    };
    expect(reset.provider).toBeNull();
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    const group = await h.group(runId, 'g1');
    expect(group.attempts.filter((attempt) => attempt.stepId === 'code')).toHaveLength(1);
  });

  it('keeps the provider after a restart of the daemon', async () => {
    const h = await start(CONFIG);
    h.script({ code: [{ hang: true }] });
    const runId = await runWith(h, 'zai');
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await h.call('run_provider', { runId, provider: 'openai' });
    await h.restart();
    expect((await h.status(runId)).provider).toBe('openai');
  });

  it('refuses an unknown provider and changes nothing', async () => {
    const h = await start(CONFIG);
    h.script({ code: [{ hang: true }] });
    const runId = await runWith(h, 'zai');
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await expect(h.call('run_provider', { runId, provider: 'nope' })).rejects.toThrow(
      'unknown provider `nope`; known: anthropic, openai, zai',
    );
    const view = await h.status(runId);
    expect(view.provider).toBe('zai');
    expect(view.groups[0]?.status).toBe('running');
  });

  it('changes nothing when the run already has the provider', async () => {
    const h = await start(CONFIG);
    h.script({ code: [{ hang: true }] });
    const runId = await runWith(h, 'zai');
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await h.call('run_provider', { runId, provider: 'zai' });
    const group = await h.group(runId, 'g1');
    expect(group.attempts).toHaveLength(1);
    expect(group.attempts[0]?.status).toBe('running');
  });

  it('refuses a finished run', async () => {
    const h = await start(CONFIG);
    const runId = await runWith(h, 'zai');
    await h.waitFor(runId, (view) => view.finished);
    await expect(h.call('run_provider', { runId, provider: 'openai' })).rejects.toThrow(
      'is finished',
    );
  });
});
