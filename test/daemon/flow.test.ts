import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunCreated } from '../../src/presentation/ipc/contract/index.ts';

import { PIPELINE_CONFIG, git, harness, startRun, statuses, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(config?: string, environment?: NodeJS.ProcessEnv): Promise<Harness> {
  current = await harness(config, environment);
  return current;
}

async function run(
  h: Harness,
  groups = [{ title: 'Логин', task: 'добавить логин' }],
): Promise<string> {
  const created = (await startRun(h, {
    repository: h.repo,
    pipeline: 'feature',
    groups,
  })) as RunCreated;
  return created.runId;
}

describe('daemon flow', () => {
  it('runs two groups through every step and merges both into the run branch', async () => {
    const h = await start();
    h.script({ code: [{ write: { 'feature.ts': 'export const feature = true;\n' } }] });
    const runId = await run(h, [
      { title: 'Логин', task: 'добавить логин' },
      { title: 'Выход', task: 'добавить выход' },
    ]);
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged', 'merged']);
    const log = git(h.repo, 'log', '--format=%s', `refs/aip/${runId}/run`);
    expect(git(h.repo, 'branch', '--list', 'aip/*')).toBe('');
    expect(log).toContain('aip: merge login');
    expect(log).toContain('aip: merge vyhod');
    expect(log).toContain('aip(login/code): code done');
    expect(git(h.repo, 'branch', '--show-current')).toBe('main');
    expect(git(h.repo, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(h.repo, 'feature.ts'))).toBe(false);
    expect(final.usage).toEqual({ inputTokens: 400, outputTokens: 80, costUsd: 0.04 });
    const detail = await h.group(runId, 'login');
    expect(detail.attempts.map((attempt) => [attempt.stepId, attempt.verdict])).toEqual([
      ['code', 'done'],
      ['review', 'done'],
    ]);
    expect(detail.worktree.startsWith(join(h.repo, '.aip', 'worktrees'))).toBe(true);
    expect(detail.log?.lines.some((line) => line.includes('"type":"result"'))).toBe(true);
    expect(readFileSync(join(h.repo, '.git', 'info', 'exclude'), 'utf8')).toContain('/.aip/');
    expect(statSync(h.socket).mode & 0o777).toBe(0o600);
  });
});

describe('specialist limit', () => {
  it('never runs more than one limited coder at a time and finishes every group', async () => {
    const h = await start(
      PIPELINE_CONFIG.replace('coder: { name: Кодировщик }', 'coder: { name: Кодировщик, max: 1 }'),
    );
    // the coders wait until the test has seen the other groups wait for the limited specialist
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const runId = await run(h, [
      { title: 'Первая', task: 'один' },
      { title: 'Вторая', task: 'два' },
      { title: 'Третья', task: 'три' },
    ]);
    const held = await h.waitFor(runId, (view) =>
      view.specialists.some((use) => use.running.length === 1 && use.waiting.length === 2),
    );
    expect(held.groups.filter((group) => group.status === 'running')).toHaveLength(1);
    h.open('code');
    let peak = 0;
    const final = await h.waitFor(runId, (view) => {
      const coding = view.groups.filter(
        (group) => group.status === 'running' && group.step === 'code',
      ).length;
      peak = Math.max(peak, coding);
      return view.finished;
    });
    expect(statuses(final)).toEqual(['merged', 'merged', 'merged']);
    expect(peak).toBe(1);
  });

  it('reports the running and the waiting group of a limited specialist in the run view', async () => {
    const h = await start(
      PIPELINE_CONFIG.replace('coder: { name: Кодировщик }', 'coder: { name: Кодировщик, max: 1 }'),
    );
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const runId = await run(h, [
      { title: 'Первая', task: 'один' },
      { title: 'Вторая', task: 'два' },
    ]);
    const busy = await h.waitFor(runId, (view) =>
      view.specialists.some((use) => use.running.length === 1 && use.waiting.length === 1),
    );
    expect(busy.specialists).toMatchObject([
      {
        specialist: 'coder',
        level: 'project',
        max: 1,
        running: [{ slug: 'pervaya', step: 'code' }],
        waiting: [{ slug: 'vtoraya', step: 'code' }],
      },
    ]);
    h.open('code');
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.specialists).toEqual([]);
  });
});

describe('configuration directory', () => {
  it('starts a run whose specialists and pipeline live only in the project aip/', async () => {
    const h = await start();
    rmSync(join(h.repo, 'aip'), { recursive: true });
    mkdirSync(join(h.repo, 'aip', 'specialists'), { recursive: true });
    mkdirSync(join(h.repo, 'aip', 'pipelines'));
    writeFileSync(join(h.repo, 'aip', 'specialists', 'coder.yaml'), 'name: Кодировщик\n');
    writeFileSync(
      join(h.repo, 'aip', 'specialists', 'reviewer.yaml'),
      'name: Ревьюер\npermissions: read\n',
    );
    writeFileSync(join(h.repo, 'aip', 'settings.yaml'), 'delivery: { auto: false }\n');
    writeFileSync(
      join(h.repo, 'aip', 'pipelines', 'feature.yaml'),
      'steps:\n  - { id: code, specialist: coder }\n  - { id: review, specialist: reviewer }\n',
    );
    const runId = await run(h);
    const view = await h.waitFor(runId, (state) => state.finished);
    expect(view.groups.map((group) => group.status)).toEqual(['merged']);
  });
});
