import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionView, ProjectLinkView } from '../../src/presentation/ipc/contract/index.ts';
import { startFakeRegistry, type FakeRegistry } from '../fakes/registry-api.ts';
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

/** `coder` goes through the registry; `reviewer` has no such server. */
const CONFIG = `swarm:
  max: 3
  specialists:
    coder: { name: Coder, mcp_servers: [registry] }
    reviewer: { name: Reviewer, permissions: read }
  mcp_servers:
    registry: { connection: main }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer }
`;

const API = { path: 'acme/backend/api', name: 'api', repo_url: 'https://github.com/acme/api' };

async function start(
  timings: { registryProjectMs?: number } = {},
): Promise<{ h: Harness; fake: FakeRegistry }> {
  registry = await startFakeRegistry();
  registry.projects = [API];
  daemon = await harness(CONFIG, {}, { integrations: { secretStore: new MemoryStore() }, timings });
  mkdirSync(daemon.fakeState, { recursive: true });
  daemon.environment.AIP_FAKE_ARGV_LOG = join(daemon.fakeState, 'argv.jsonl');
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/api.git'], {
    cwd: daemon.repo,
  });
  await daemon.call('repository_add', { path: daemon.repo });
  return { h: daemon, fake: registry };
}

async function connection(h: Harness, fake: FakeRegistry, enable = true): Promise<string> {
  const added = (await h.call('integration_add', {
    kind: 'service-registry',
    name: 'main',
    global: true,
    params: { url: fake.base },
  })) as ConnectionView;
  await h.call('integration_secret_set', { id: added.id, slot: 'token', value: fake.token });
  if (enable) await h.call('integration_enable', { id: added.id });
  return added.id;
}

const links = (h: Harness, repository?: string) =>
  h.call('integration_links', repository === undefined ? {} : { repository }) as Promise<
    ProjectLinkView[]
  >;

/** The system prompts the fake claude was started with, in the order of the attempts. */
function prompts(h: Harness): string[] {
  return readFileSync(join(h.fakeState, 'argv.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => (JSON.parse(line) as { argv: string[] }).argv)
    .filter((argv) => argv.includes('--append-system-prompt'))
    .map((argv) => argv[argv.indexOf('--append-system-prompt') + 1]!);
}

async function runOnce(h: Harness) {
  const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'do it' });
  return h.waitFor(runId, (view) => view.finished);
}

describe('the link of a project to the registry', () => {
  it('is made by origin when the connection is enabled', async () => {
    const { h, fake } = await start();
    await connection(h, fake);
    await until('the project is linked', async () => (await links(h)).length === 1);
    const [link] = await links(h, h.repo);
    expect(link).toMatchObject({
      project: h.repo,
      connectionName: 'main',
      registryPath: 'acme/backend/api',
      source: 'auto',
      status: 'linked',
      url: expect.stringContaining(fake.base) as string,
    });
    expect(link?.url).toContain(encodeURIComponent('acme/backend/api'));
  });

  it('is told to the specialist that has the server, and only to it', async () => {
    const { h, fake } = await start();
    await connection(h, fake);
    await until('the project is linked', async () => (await links(h)).length === 1);
    h.script({ code: [{}], review: [{}] });
    const final = await runOnce(h);
    expect(final.groups[0]?.status).toBe('merged');
    const [coder, reviewer] = prompts(h);
    expect(coder).toContain(
      'Service registry project: `acme/backend/api` (MCP server `registry`); pass this path to the registry tools.',
    );
    expect(reviewer).toBeDefined();
    expect(reviewer).not.toContain('Service registry project');
    // the attempt keeps what it was told
    const state = h.running.application.services.runs.states.all()[0]!;
    const attempts = state.groups[0]!.attempts;
    expect(attempts[0]?.input.registryProject).toEqual({
      path: 'acme/backend/api',
      server: 'registry',
    });
    expect(attempts[1]?.input.registryProject).toBeUndefined();
  });

  it('does not stop an attempt when the registry fails; the status says why', async () => {
    const { h, fake } = await start();
    fake.failWith = Array.from({ length: 20 }, () => 503);
    await connection(h, fake);
    await until('matching ended', async () => (await links(h)).length === 1);
    expect(await links(h)).toMatchObject([
      { registryPath: null, status: 'unreachable', url: null },
    ]);
    h.script({ code: [{}], review: [{}] });
    const final = await runOnce(h);
    expect(final.groups[0]?.status).toBe('merged');
    expect(prompts(h).every((text) => !text.includes('Service registry project'))).toBe(true);
  });

  it('does not wait for a registry that is silent: the attempt starts without the line', async () => {
    const { h, fake } = await start({ registryProjectMs: 100 });
    // the matching after the enabling hangs; the attempt asks the same pair and waits for it
    fake.delayMs = 2000;
    await connection(h, fake);
    h.script({ code: [{}], review: [{}] });
    const begin = Date.now();
    const final = await runOnce(h);
    expect(final.groups[0]?.status).toBe('merged');
    expect(Date.now() - begin).toBeLessThan(1500);
    expect(prompts(h).every((text) => !text.includes('Service registry project'))).toBe(true);
    const attempt = h.running.application.services.runs.states.all()[0]!.groups[0]!.attempts[0]!;
    expect(attempt.input.registryProject).toBeUndefined();
    fake.delayMs = 0;
  });

  it('does not start the agent for a message that came while the registry was asked', async () => {
    const { h, fake } = await start({ registryProjectMs: 600 });
    fake.delayMs = 3000;
    await connection(h, fake);
    h.script({ code: [{}], review: [{}] });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'do it' });
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    const slug = (await h.status(runId)).groups[0]!.slug;
    await h.call('message', { runId, group: slug, seq: 1, text: 'use OAuth' });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]?.status).toBe('merged');
    const code = readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { step: string; args: string[] })
      .filter((call) => call.step === 'code');
    // only the continuation started an agent, and it carries the text
    expect(code).toHaveLength(1);
    expect(code[0]?.args.join(' ')).toContain('use OAuth');
    fake.delayMs = 0;
  });

  it('does not start the agent of a paused run until it continues', async () => {
    const { h, fake } = await start({ registryProjectMs: 600 });
    fake.delayMs = 3000;
    await connection(h, fake);
    h.script({ code: [{}], review: [{}] });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'do it' });
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    const paused = (await h.call('run_pause', { runId })) as { item: string };
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(existsSync(join(h.fakeState, 'calls.jsonl'))).toBe(false);
    fake.delayMs = 0;
    await h.call('queue_run_now', { repository: h.repo, item: paused.item });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]?.status).toBe('merged');
  });

  it('shows the same line on a retry, whatever the registry does by then', async () => {
    const { h, fake } = await start();
    await connection(h, fake);
    await until('the project is linked', async () => (await links(h)).length === 1);
    h.script({ code: [{ hang: true }, {}], review: [{}] });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'do it' });
    await until('the agent started', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    await h.call('cancel', { runId });
    const cancelled = await h.waitFor(runId, (view) => view.finished);
    fake.failWith = Array.from({ length: 50 }, () => 503);
    await h.call('retry', { runId, group: cancelled.groups[0]!.slug });
    const final = await h.waitFor(runId, (view) => view.state === 'finished');
    expect(final.groups[0]?.status).toBe('merged');
    const line =
      'Service registry project: `acme/backend/api` (MCP server `registry`); pass this path to the registry tools.';
    const [first, second] = prompts(h);
    expect(first).toContain(line);
    expect(second).toContain(line);
  });

  it('keeps a manual link, refuses a wrong path and forgets the link with --clear', async () => {
    const { h, fake } = await start();
    fake.projects = [API, { path: 'acme/legacy/api', name: 'legacy', repo_url: 'x' }];
    await connection(h, fake);
    await until('the project is linked', async () => (await links(h)).length === 1);
    const manual = (await h.call('integration_link', {
      id: 'main',
      repository: h.repo,
      path: 'acme/legacy/api',
    })) as ProjectLinkView;
    expect(manual).toMatchObject({ registryPath: 'acme/legacy/api', source: 'manual' });
    await expect(
      h.call('integration_link', { id: 'main', repository: h.repo, path: 'acme/none' }),
    ).rejects.toThrow('project acme/none is not found in the service registry');
    expect(
      (await h.call('integration_link', {
        id: 'main',
        repository: h.repo,
        auto: true,
      })) as ProjectLinkView,
    ).toMatchObject({ registryPath: 'acme/legacy/api', source: 'manual' });
    const cleared = (await h.call('integration_link', {
      id: 'main',
      repository: h.repo,
      clear: true,
    })) as ProjectLinkView;
    expect(cleared).toMatchObject({ registryPath: null, status: 'disabled', url: null });
  });

  it('follows the project when it moves and goes with the connection', async () => {
    const { h, fake } = await start();
    const id = await connection(h, fake);
    await until('the project is linked', async () => (await links(h)).length === 1);
    const moved = join(dirname(h.repo), 'moved');
    renameSync(h.repo, moved);
    await h.call('repository_move', { path: h.repo, to: moved });
    expect(await links(h, moved)).toMatchObject([{ registryPath: 'acme/backend/api' }]);
    expect(await links(h, h.repo).catch(() => [])).toEqual([]);
    await h.call('integration_remove', { id });
    expect(await links(h)).toEqual([]);
  });
});
