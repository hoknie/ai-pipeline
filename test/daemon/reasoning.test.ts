import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeConfigDirectory } from '../fixtures/config.ts';
import { CODE_ONLY_CONFIG, type Harness } from './harness.ts';
import { run, start } from './control-harness.ts';

function configuration(effort: string, variant: string): string {
  return CODE_ONLY_CONFIG.replace(
    'coder: { name: Кодировщик }',
    `coder: { name: Кодировщик, runtime: opencode, reasoning_effort: ${effort}, variant: ${variant} }`,
  );
}

function launches(h: Harness) {
  return readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { step: string; args: string[]; configPath: string })
    .filter((call) => call.step === 'code')
    .map((call) => ({
      args: call.args,
      effort: JSON.parse(readFileSync(call.configPath, 'utf8')).agent['aip-coder'].options
        .reasoningEffort,
      variant: call.args[call.args.indexOf('--variant') + 1],
    }));
}

describe('OpenCode reasoning settings of a run', () => {
  it('keeps snapshot options on retry and updates both only with refreshConfig', async () => {
    const h = await start(configuration('high', 'deep'));
    h.script({ code: [{ noReport: true, exitCode: 1 }, { noReport: true, exitCode: 1 }, {}] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'failed');
    writeConfigDirectory(h.repo, configuration('xhigh', 'concise'));
    await h.call('retry', { runId, group: 'g1' });
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'failed');
    await h.call('retry', { runId, group: 'g1', refreshConfig: true });
    await h.waitFor(runId, (view) => view.finished);
    expect(launches(h).map(({ effort, variant }) => ({ effort, variant }))).toEqual([
      { effort: 'high', variant: 'deep' },
      { effort: 'high', variant: 'deep' },
      { effort: 'xhigh', variant: 'concise' },
    ]);
    expect((await h.group(runId, 'g1')).warnings.join('\n')).toContain(
      'reasoning_effort high → xhigh',
    );
  });

  it('continues the same session after an answer with snapshot options', async () => {
    const h = await start(configuration('high', 'deep'));
    h.script({ code: [{ verdict: 'needs_human', feedback: 'Продолжить?' }, {}] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'needs_human');
    writeConfigDirectory(h.repo, configuration('xhigh', 'concise'));
    await h.call('answer', { runId, group: 'g1', answer: 'Да' });
    await h.waitFor(runId, (view) => view.finished);
    const calls = launches(h);
    expect(calls.map(({ effort, variant }) => ({ effort, variant }))).toEqual([
      { effort: 'high', variant: 'deep' },
      { effort: 'high', variant: 'deep' },
    ]);
    expect(calls[1]!.args).toContain('-s');
    expect(calls[1]!.args[calls[1]!.args.indexOf('-s') + 1]).toBe('ses_fake');
  });
});
