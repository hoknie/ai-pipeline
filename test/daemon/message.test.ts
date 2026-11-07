import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Transcript } from '../../src/presentation/ipc/contract/index.ts';
import { statuses } from './harness.ts';
import { calls, run, start, until } from './control-harness.ts';

function timesFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('output.times'))
    .map((path) => join(root, path));
}

describe('times of the log lines', () => {
  it('gives the entries of a transcript the time they were received', async () => {
    const h = await start();
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    const before = Date.now();
    const full = (await h.call('transcript', { runId, group: 'g1', seq: 1 })) as Transcript;
    expect(full.entries.length).toBeGreaterThan(1);
    const moments = full.entries.map((entry) => entry.at);
    for (const at of moments) expect(typeof at).toBe('number');
    const times = moments as number[];
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times.at(-1)).toBeLessThanOrEqual(before);
    const detail = await h.group(runId, 'g1');
    expect(times[0]).toBeGreaterThanOrEqual(detail.attempts[0]!.startedAt);

    // only the entries after the cursor are returned, with their own time
    const tail = (await h.call('transcript', {
      runId,
      group: 'g1',
      seq: 1,
      after: full.cursor - 1,
    })) as Transcript;
    expect(tail.entries).toHaveLength(1);
    expect(tail.entries[0]?.at).toBe(times.at(-1));
  });

  it('shows the entries of an attempt without a times file with an empty time', async () => {
    const h = await start();
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    // only the logs: the cleanup of the run may be removing its worktrees right now
    const files = timesFiles(join(h.repo, '.aip', 'logs'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) rmSync(file);
    const full = (await h.call('transcript', { runId, group: 'g1', seq: 1 })) as Transcript;
    expect(full.entries.length).toBeGreaterThan(0);
    expect(full.entries.every((entry) => entry.at === null)).toBe(true);
  });
});

describe('a message to a running specialist', () => {
  it('stops the attempt and continues the step in the same session with the text', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('code') }, {}] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await until('the agent started', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    await h.call('message', { runId, group: 'g1', seq: 1, text: 'используй OAuth' });
    // a second message to the same attempt is refused whether it is stopping or already gone
    await expect(
      h.call('message', { runId, group: 'g1', seq: 1, text: 'ещё одно' }),
    ).rejects.toThrow('attempt 1');
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    const codeCalls = calls(h).filter((call) => call.step === 'code');
    expect(codeCalls).toHaveLength(2);
    expect(codeCalls[1]?.args).toContain('--resume');
    expect(codeCalls[1]?.args.join(' ')).toContain('Message from the person');
    expect(codeCalls[1]?.args.join(' ')).toContain('используй OAuth');
    expect(codeCalls[1]?.args.join(' ')).not.toContain('ещё одно');
    const detail = await h.group(runId, 'g1');
    expect(detail.attempts[0]).toMatchObject({
      status: 'cancelled',
      reason: 'interrupted by a message',
      interrupting: false,
      message: null,
    });
    expect(detail.attempts[1]).toMatchObject({
      stepId: 'code',
      verdict: 'done',
      message: { text: 'используй OAuth' },
    });
  });

  it('refuses a message to an attempt that does not run', async () => {
    const h = await start();
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    await expect(h.call('message', { runId, group: 'g1', seq: 1, text: 'поздно' })).rejects.toThrow(
      'attempt 1 is not running',
    );
  });
});
