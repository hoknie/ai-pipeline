import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionView } from '../../src/presentation/ipc/contract/index.ts';
import { startFakeRegistry, type FakeRegistry } from '../fakes/registry-api.ts';
import { buildZip } from '../fakes/zip.ts';
import { MemoryStore } from '../feature/integrations/helpers.ts';

import { harness, startRun, until, type Harness } from './harness.ts';

let daemon: Harness | null = null;
let registry: FakeRegistry | null = null;

afterEach(async () => {
  await daemon?.close();
  await registry?.close();
  daemon = null;
  registry = null;
});

const CONFIG = `swarm:
  max: 3
  specialists:
    coder: { name: Coder, skills: ["registry:go-testing@^1"] }
    reviewer: { name: Reviewer, permissions: read }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }
`;

function archive(version: string): Buffer {
  return buildZip([
    { name: 'go-testing/SKILL.md', data: `---\nname: go-testing\n---\nVersion ${version}\n` },
    { name: 'go-testing/scripts/run.sh', data: 'echo ok\n' },
  ]);
}

function lines(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function start(): Promise<{ h: Harness; fake: FakeRegistry }> {
  registry = await startFakeRegistry();
  daemon = await harness(CONFIG, {}, { integrations: { secretStore: new MemoryStore() } });
  mkdirSync(daemon.fakeState, { recursive: true });
  daemon.environment.AIP_FAKE_ARGV_LOG = join(daemon.fakeState, 'argv.jsonl');
  const added = (await daemon.call('integration_add', {
    kind: 'service-registry',
    name: 'main',
    global: true,
    params: { url: registry.base },
  })) as ConnectionView;
  await daemon.call('integration_secret_set', {
    id: added.id,
    slot: 'token',
    value: registry.token,
  });
  await daemon.call('integration_enable', { id: added.id });
  registry.skills.push({
    id: 'sk-1',
    name: 'go-testing',
    versions: { '1.2.0': archive('1.2.0'), '1.4.1': archive('1.4.1') },
  });
  return { h: daemon, fake: registry };
}

describe('registry skills of a specialist', () => {
  it('hands the skill folder to the agent, leaves the worktree alone and keeps the version on a return', async () => {
    const { h, fake } = await start();
    const skillLook = { skills: ['go-testing'], read: ['.claude/skills/go-testing/SKILL.md'] };
    h.script({
      code: [skillLook, skillLook],
      review: [
        { waitFor: h.gate('review'), verdict: 'rejected', feedback: 'once more' },
        { verdict: 'done' },
      ],
    });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'do it' });
    await until('the first attempt looked for the skill', () =>
      existsSync(join(h.fakeState, 'skills.jsonl')),
    );
    // a newer version appears while the run goes on
    fake.skills[0]!.versions['1.5.0'] = archive('1.5.0');
    h.open('review');
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]?.status).toBe('merged');

    const seen = lines(join(h.fakeState, 'skills.jsonl'));
    expect(seen).toHaveLength(2);
    for (const one of seen) {
      expect(String((one.found as Record<string, string>)['go-testing'])).toContain(
        'Version 1.4.1',
      );
      const [folder] = one.folders as string[];
      expect(folder).toMatch(/skills$/u);
      expect(folder).toContain(`/logs/${runId}/`);
    }
    // the agent did not find the skill in its worktree
    const reads = lines(join(h.fakeState, 'reads.jsonl'));
    expect(
      reads.map(
        (one) => (one.contents as Record<string, unknown>)['.claude/skills/go-testing/SKILL.md'],
      ),
    ).toEqual([null, null]);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: h.repo, encoding: 'utf8' })).toBe(
      '',
    );

    // one download, one version fixed for the run, and it is shown in the state of the run
    expect(fake.downloads).toEqual(['sk-1@1.4.1']);
    expect(final.pinnedSkills).toEqual([{ name: 'go-testing', version: '1.4.1' }]);
    const argv = lines(join(h.fakeState, 'argv.jsonl')).filter((one) =>
      (one.argv as string[]).includes('--session-id'),
    );
    const dirs = argv.map((one) => {
      const list = one.argv as string[];
      return list.filter((_, index) => list[index - 1] === '--add-dir');
    });
    expect(dirs.some((list) => list.some((dir) => dir.endsWith('/skills')))).toBe(true);
  });

  it('does not hold the queue while the registry hangs, and the cancelled attempt never starts', async () => {
    const { h, fake } = await start();
    fake.delayMs = 4000;
    h.script({ code: [{ skills: ['go-testing'] }], review: [{}] });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'do it' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    // a mutation goes through the serial queue meanwhile
    const started = Date.now();
    await h.call('cancel', { runId });
    expect(Date.now() - started).toBeLessThan(2000);
    fake.delayMs = 0;
    await h.waitFor(runId, (view) => view.finished);
    expect(existsSync(join(h.fakeState, 'skills.jsonl'))).toBe(false);
  });

  it('tries again for the next attempt when the registry did not answer for the first', async () => {
    const { h, fake } = await start();
    fake.failWith = Array.from({ length: 50 }, () => 503);
    const skillLook = { skills: ['go-testing'] };
    h.script({
      code: [skillLook, skillLook],
      review: [
        { waitFor: h.gate('review'), verdict: 'rejected', feedback: 'once more' },
        { verdict: 'done' },
      ],
    });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'do it' });
    await until('the first attempt started without the skill', () =>
      existsSync(join(h.fakeState, 'skills.jsonl')),
    );
    expect(fake.downloads).toEqual([]);
    fake.failWith = [];
    h.open('review');
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.pinnedSkills).toEqual([{ name: 'go-testing', version: '1.4.1' }]);
    const seen = lines(join(h.fakeState, 'skills.jsonl'));
    expect(seen).toHaveLength(2);
    expect((seen[0]?.found as Record<string, unknown>)['go-testing']).toBeNull();
    expect(String((seen[1]?.found as Record<string, string>)['go-testing'])).toContain(
      'Version 1.4.1',
    );
  });

  it('starts the step without the skill and fixes nothing when the registry is unreachable', async () => {
    const { h, fake } = await start();
    await fake.close();
    registry = null;
    h.script({ code: [{ skills: ['go-testing'] }], review: [{}] });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'do it' });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]?.status).toBe('merged');
    expect(final.pinnedSkills).toEqual([]);
    const seen = lines(join(h.fakeState, 'skills.jsonl'));
    expect((seen[0]?.found as Record<string, unknown>)['go-testing']).toBeNull();
    const group = final.groups[0]!.slug;
    const log = readFileSync(join(h.repo, '.aip', 'logs', runId, group, '1', 'output.log'), 'utf8');
    expect(log).toContain('skill not found: registry:go-testing@^1 (unreachable)');
  });
});
