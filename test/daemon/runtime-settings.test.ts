import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MANUAL_CONFIG, harness, startRun, type Harness } from './harness.ts';

const fakeClaude = join(import.meta.dirname, '..', 'fakes', 'claude');

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

/** A daemon without AIP_CLAUDE_BIN: the command comes from the shared settings.yaml. */
async function start(): Promise<{ h: Harness; log: string; settings(text: string): void }> {
  const h = await harness(MANUAL_CONFIG, { AIP_CLAUDE_BIN: undefined });
  current = h;
  const argvLog = join(h.fakeState, 'argv.jsonl');
  h.environment.AIP_FAKE_ARGV_LOG = argvLog;
  h.environment.AIP_FAKE_ENV_KEYS = 'MY_FLAG';
  const directory = join(h.environment.XDG_CONFIG_HOME!, 'aip');
  mkdirSync(directory, { recursive: true });
  mkdirSync(h.fakeState, { recursive: true });
  return {
    h,
    log: argvLog,
    settings: (text) => writeFileSync(join(directory, 'settings.yaml'), text),
  };
}

function calls(log: string): { argv: string[]; env: Record<string, string | null> }[] {
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

async function run(h: Harness): Promise<string> {
  return (await startRun(h, { repository: h.repo, workflow: 'feature', task: 'сделать' })).runId;
}

describe('runtimes in the shared settings.yaml', () => {
  it('start the command with the arguments and variables of the settings', async () => {
    const { h, log, settings } = await start();
    settings(
      `runtimes:\n  claude:\n    command: ${fakeClaude}\n    args: [--add-dir, /data]\n    env: { MY_FLAG: on }\n`,
    );
    const final = await h.waitFor(await run(h), (view) => view.finished);
    expect(final.groups[0]?.status).toBe('merged');
    const [first] = calls(log).filter((call) => call.argv.includes('--session-id'));
    expect(first?.argv.slice(0, 3)).toEqual(['--add-dir', '/data', '-p']);
    expect(first?.env.MY_FLAG).toBe('on');
  });

  it('take a change made while the daemon runs', async () => {
    const { h, log, settings } = await start();
    settings(`runtimes:\n  claude:\n    command: ${fakeClaude}\n    args: [--one]\n`);
    await h.waitFor(await run(h), (view) => view.finished);
    settings(`runtimes:\n  claude:\n    command: ${fakeClaude}\n    args: [--two]\n`);
    await h.waitFor(await run(h), (view) => view.finished);
    const firsts = calls(log)
      .filter((call) => call.argv.includes('--session-id'))
      .map((call) => call.argv[0]);
    expect(firsts[0]).toBe('--one');
    expect(firsts.at(-1)).toBe('--two');
  });

  it('fail the step with spawn error when the section is wrong', async () => {
    const { h, settings } = await start();
    settings(`runtimes:\n  claude:\n    command: ${fakeClaude}\n`);
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    // the section is broken while the run is under way: the next step cannot start
    settings(`runtimes:\n  claude:\n    command: ${fakeClaude}\n    args: 1\n`);
    h.open('code');
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]?.status).toBe('failed');
    expect(final.groups[0]?.reason).toContain('spawn error: invalid swarm.runtimes');
    expect(final.groups[0]?.reason).toContain('swarm.runtimes.claude.args');
  });

  it('fail the step when the command does not exist', async () => {
    const { h, settings } = await start();
    settings('runtimes:\n  claude:\n    command: /nonexistent/claude\n');
    const final = await h.waitFor(await run(h), (view) => view.finished);
    expect(final.groups[0]).toMatchObject({
      status: 'failed',
      reason: 'runtime not found: claude',
    });
  });
});
