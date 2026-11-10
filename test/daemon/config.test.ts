import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { revisionOf } from '../../src/feature/swarm-edit/services/index.ts';
import { type ConfigEditorView } from '../../src/feature/swarm-edit/types/index.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditResult,
  ConfigPreview,
  RunCreated,
} from '../../src/presentation/ipc/contract/index.ts';

import { PIPELINE_CONFIG, harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(config?: string): Promise<Harness> {
  current = await harness(config);
  return current;
}

const coderFile = (h: Harness) => join(h.repo, 'aip', 'specialists', 'coder.yaml');

async function view(h: Harness): Promise<ConfigEditorView & { repository: string }> {
  return (await h.call('config', { repository: h.repo })) as ConfigEditorView & {
    repository: string;
  };
}

async function write(
  h: Harness,
  id: string,
  value: Record<string, unknown>,
  revision: string | null,
): Promise<ConfigEditResult> {
  return (await h.call('config_write', {
    repository: h.repo,
    kind: 'specialist',
    id,
    value,
    revision,
  })) as ConfigEditResult;
}

describe('config editor', () => {
  it('round-trips OpenCode options through the existing configuration transport', async () => {
    const h = await start();
    const coder = (await view(h)).specialists[0]!;
    expect(
      await write(
        h,
        'coder',
        {
          ...coder.raw,
          runtime: 'opencode',
          model: 'openai/gpt-6.1-sol',
          variant: 'deep',
          reasoning_effort: 'xhigh',
        },
        coder.revision,
      ),
    ).toMatchObject({ ok: true });
    const saved = (await view(h)).specialists[0]!;
    expect(saved.raw).toMatchObject({ variant: 'deep', reasoning_effort: 'xhigh' });
    expect(saved.effective).toMatchObject({ variant: 'deep', reasoning_effort: 'xhigh' });
    const { variant: _variant, reasoning_effort: _effort, ...cleared } = saved.raw;
    expect(await write(h, 'coder', cleared, saved.revision)).toMatchObject({ ok: true });
    expect((await view(h)).specialists[0]!.effective).toMatchObject({
      variant: null,
      reasoning_effort: null,
    });
  });

  it('returns the specialists with levels, files and revisions', async () => {
    const h = await start();
    const result = await view(h);
    expect(result.repository).toBe(h.repo);
    expect(result.errors).toEqual([]);
    expect(result.specialists.map((specialist) => [specialist.slug, specialist.level])).toEqual([
      ['coder', 'project'],
      ['reviewer', 'project'],
    ]);
    const coder = result.specialists[0];
    expect(coder?.file).toBe(coderFile(h));
    expect(coder?.revision).toBe(revisionOf(readFileSync(coderFile(h), 'utf8')));
  });

  it('writes a change and answers with the new revision', async () => {
    const h = await start();
    const before = await view(h);
    const coder = before.specialists[0]!;
    const result = await write(h, 'coder', { ...coder.raw, model: 'opus' }, coder.revision);
    expect(result).toEqual({
      ok: true,
      file: coderFile(h),
      revision: revisionOf(readFileSync(coderFile(h), 'utf8')),
    });
    expect(readFileSync(coderFile(h), 'utf8')).toContain('model: opus');
    expect((await view(h)).specialists[0]?.effective?.model).toBe('opus');
  });

  it('refuses an invalid value with the errors and keeps the file', async () => {
    const h = await start();
    const coder = (await view(h)).specialists[0]!;
    const text = readFileSync(coderFile(h), 'utf8');
    const result = await write(h, 'coder', { ...coder.raw, timeout: 'полчаса' }, coder.revision);
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.specialists.coder.timeout', file: coderFile(h) }],
    });
    expect(readFileSync(coderFile(h), 'utf8')).toBe(text);
  });

  it('reports a conflict after an outside edit and creates a new specialist', async () => {
    const h = await start();
    const coder = (await view(h)).specialists[0]!;
    writeFileSync(coderFile(h), 'name: Правка руками\n');
    expect(await write(h, 'coder', { name: 'X' }, coder.revision)).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    expect(readFileSync(coderFile(h), 'utf8')).toBe('name: Правка руками\n');
    expect(await write(h, 'qa', { name: 'QA' }, null)).toMatchObject({ ok: true });
    expect(existsSync(join(h.repo, 'aip', 'specialists', 'qa.yaml'))).toBe(true);
  });

  it('refuses to delete a used specialist and deletes a free one', async () => {
    const h = await start();
    const reviewer = (await view(h)).specialists.find((s) => s.slug === 'reviewer')!;
    const refused = await h.call('config_delete', {
      repository: h.repo,
      kind: 'specialist',
      id: 'reviewer',
      revision: reviewer.revision!,
    });
    expect(refused).toMatchObject({
      ok: false,
      reason: 'invalid',
      references: [{ pipeline: 'feature', step: 'review' }],
    });
    expect(existsSync(reviewer.file)).toBe(true);
    await write(h, 'extra', { name: 'Extra' }, null);
    const extra = (await view(h)).specialists.find((s) => s.slug === 'extra')!;
    const deleted = await h.call('config_delete', {
      repository: h.repo,
      kind: 'specialist',
      id: 'extra',
      revision: extra.revision!,
    });
    expect(deleted).toMatchObject({ ok: true, revision: null });
    expect(existsSync(extra.file)).toBe(false);
  });

  it('rejects a slug that is not a slug before looking at the disk', async () => {
    const h = await start();
    mkdirSync(join(h.repo, 'aip'), { recursive: true });
    await expect(write(h, '../settings', { name: 'X' }, null)).rejects.toThrow(/id must match/);
    expect(readFileSync(join(h.repo, 'aip', 'settings.yaml'), 'utf8')).toContain('max');
  });

  it('keeps the snapshot of a running run and gives the new model to new runs', async () => {
    const h = await start(
      PIPELINE_CONFIG.replace(
        'coder: { name: Кодировщик }',
        'coder: { name: Кодировщик, model: sonnet }',
      ),
    );
    h.script({ code: [{ exitCode: 1, noReport: true }, {}] });
    const first = (
      (await startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        groups: [{ title: 'g1', task: 'task' }],
      })) as RunCreated
    ).runId;
    await h.waitFor(first, (run) => run.groups[0]?.status === 'failed');
    const coder = (await view(h)).specialists.find((s) => s.slug === 'coder')!;
    expect(await write(h, 'coder', { ...coder.raw, model: 'opus' }, coder.revision)).toMatchObject({
      ok: true,
    });
    await h.call('retry', { runId: first, group: 'g1' });
    await h.waitFor(first, (run) => run.finished);
    h.script({});
    const second = (
      (await startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        groups: [{ title: 'g2', task: 'task' }],
      })) as RunCreated
    ).runId;
    await h.waitFor(second, (run) => run.finished);
    const calls = readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { step: string; group: string; args: string[] })
      .filter((call) => call.step === 'code');
    const models = calls.map((call) => call.args[call.args.indexOf('--model') + 1]);
    expect(models).toEqual(['sonnet', 'sonnet', 'opus']);
  });
});

describe('pipeline editing', () => {
  const featureFile = (h: Harness) => join(h.repo, 'aip', 'pipelines', 'feature.yaml');
  const steps = [
    { id: 'code', specialist: 'coder' },
    { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 2 } },
  ];

  async function preview(h: Harness, value: Record<string, unknown>): Promise<ConfigPreview> {
    return (await h.call('config_preview', {
      repository: h.repo,
      kind: 'pipeline',
      id: 'feature',
      value,
    })) as ConfigPreview;
  }

  it('previews a new step without changing the file', async () => {
    const h = await start();
    await write(h, 'writer', { name: 'Автор' }, null);
    const before = readFileSync(featureFile(h), 'utf8');
    const result = await preview(h, { steps: [...steps, { id: 'docs', specialist: 'writer' }] });
    expect(result.errors).toEqual([]);
    expect(result.topology?.steps.map((step) => step.id)).toEqual(['code', 'review', 'docs']);
    expect(result.topology?.steps[2]).toMatchObject({ specialist: 'writer', name: 'Автор' });
    expect(readFileSync(featureFile(h), 'utf8')).toBe(before);
  });

  it('answers with the errors and no graph for an unknown specialist', async () => {
    const h = await start();
    const result = await preview(h, { steps: [...steps, { id: 'docs', specialist: 'reviewr' }] });
    expect(result.topology).toBeNull();
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: 'swarm.pipelines.feature.steps[2].specialist',
        message: expect.stringContaining('known: coder, reviewer'),
      }),
    );
  });

  it('lists the pipelines and writes one', async () => {
    const h = await start();
    const listed = await view(h);
    const feature = listed.pipelines.find((pipeline) => pipeline.id === 'feature')!;
    expect(feature.level).toBe('project');
    const result = (await h.call('config_write', {
      repository: h.repo,
      kind: 'pipeline',
      id: 'feature',
      value: { steps: steps.slice(0, 1) },
      revision: feature.revision,
    })) as ConfigEditResult;
    expect(result).toMatchObject({ ok: true, file: featureFile(h) });
    expect(readFileSync(featureFile(h), 'utf8')).toContain('code');
  });

  it('deletes a pipeline while its run goes on, and refuses new runs of it', async () => {
    const h = await start();
    h.script({ code: [{ exitCode: 1, noReport: true }, {}] });
    const runId = (
      (await startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        groups: [{ title: 'g1', task: 'task' }],
      })) as RunCreated
    ).runId;
    await h.waitFor(runId, (run) => run.groups[0]?.status === 'failed');
    const feature = (await view(h)).pipelines.find((pipeline) => pipeline.id === 'feature')!;
    const deleted = await h.call('config_delete', {
      repository: h.repo,
      kind: 'pipeline',
      id: 'feature',
      revision: feature.revision!,
    });
    expect(deleted).toMatchObject({ ok: true });
    expect(existsSync(featureFile(h))).toBe(false);
    await h.call('retry', { runId, group: 'g1' });
    await h.waitFor(runId, (run) => run.finished);
    await expect(
      startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        groups: [{ title: 'g2', task: 'task' }],
      }),
    ).rejects.toThrow(/unknown pipeline `feature`/);
  });
});

describe('config editor levels', () => {
  const globalFile = (h: Harness, slug: string) =>
    join(h.repo, '..', 'xdg', 'aip', 'specialists', `${slug}.yaml`);

  it('writes to the global directory with level global and to the project without it', async () => {
    const h = await start();
    const created = (await h.call('config_write', {
      repository: h.repo,
      kind: 'specialist',
      id: 'qa',
      value: { name: 'QA' },
      revision: null,
      level: 'global',
    })) as ConfigEditResult;
    expect(created).toMatchObject({ ok: true, file: globalFile(h, 'qa') });
    expect(existsSync(join(h.repo, 'aip', 'specialists', 'qa.yaml'))).toBe(false);

    const local = await write(h, 'docs', { name: 'Docs' }, null);
    expect(local).toMatchObject({
      ok: true,
      file: join(h.repo, 'aip', 'specialists', 'docs.yaml'),
    });

    const entry = (await view(h)).specialists.find((specialist) => specialist.slug === 'qa')!;
    expect(entry.level).toBe('global');
    expect(entry.sources.global?.revision).toBe(
      revisionOf(readFileSync(globalFile(h, 'qa'), 'utf8')),
    );
    expect(entry.sources.project).toBeUndefined();

    const removed = (await h.call('config_delete', {
      repository: h.repo,
      kind: 'specialist',
      id: 'qa',
      revision: entry.sources.global!.revision,
      level: 'global',
    })) as ConfigEditResult;
    expect(removed.ok).toBe(true);
    expect(existsSync(globalFile(h, 'qa'))).toBe(false);
  });

  it('previews a pipeline draft on the global level', async () => {
    const h = await start();
    const preview = (await h.call('config_preview', {
      repository: h.repo,
      kind: 'pipeline',
      id: 'feature',
      value: { steps: [{ id: 'code', specialist: 'coder' }] },
      level: 'global',
    })) as ConfigPreview;
    expect(preview.errors.map((error) => error.path)).toContain(
      'swarm.pipelines.feature.steps[0].specialist',
    );
  });
});

describe('general setting', () => {
  const globalFile = (h: Harness) =>
    join(h.environment.XDG_CONFIG_HOME ?? '', 'aip', 'settings.yaml');
  const setting = async (h: Harness, value: boolean | null, revision: string | null) =>
    (await h.call('config_setting', {
      repository: h.repo,
      path: 'delivery.auto',
      value,
      revision,
      level: 'global',
    })) as ConfigEditResult;

  it('writes the global level and changes the setting of the next run only', async () => {
    const h = await start();
    const before = await view(h);
    expect(before.settingsFiles.global).toEqual({ file: globalFile(h), revision: null });
    const running = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'x',
    })) as RunCreated;
    const result = await setting(h, false, null);
    expect(result).toMatchObject({ ok: true, file: globalFile(h) });
    expect(readFileSync(globalFile(h), 'utf8')).toBe('delivery:\n  auto: false\n');
    const after = await view(h);
    expect(after.settings.find((entry) => entry.path === 'delivery.auto')).toMatchObject({
      value: false,
      file: globalFile(h),
    });
    expect(after.settingsFiles.global.revision).toBe(revisionOf('delivery:\n  auto: false\n'));
    expect((await h.status(running.runId)).autoDeliver).toBe(true);
    await h.waitFor(running.runId, (run) => run.finished);
    const next = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'y',
    })) as RunCreated;
    expect((await h.status(next.runId)).autoDeliver).toBe(false);
  });

  it('refuses a stale revision', async () => {
    const h = await start();
    expect(await setting(h, false, null)).toMatchObject({ ok: true });
    expect(await setting(h, true, null)).toMatchObject({ ok: false, reason: 'conflict' });
  });

  const settings = async (
    h: Harness,
    values: Record<string, string | number | boolean | string[] | null>,
    level: 'global' | 'project',
    revision: string | null = null,
  ) =>
    (await h.call('config_settings', {
      repository: h.repo,
      values,
      revision,
      level,
    })) as ConfigEditResult;

  it('writes two fields in one request on the project and the global level', async () => {
    const h = await start();
    const projectFile = join(h.repo, 'aip', 'settings.yaml');
    const project = await settings(
      h,
      { max: 6, 'delivery.keep': true },
      'project',
      revisionOf(readFileSync(projectFile, 'utf8')),
    );
    expect(project).toMatchObject({ ok: true, file: join(h.repo, 'aip', 'settings.yaml') });
    expect(readFileSync(join(h.repo, 'aip', 'settings.yaml'), 'utf8')).toContain('keep: true');
    const global = await settings(
      h,
      { 'naming.enabled': false, 'defaults.tools': ['Read'] },
      'global',
    );
    expect(global).toMatchObject({ ok: true, file: globalFile(h) });
    const after = await view(h);
    expect(after.settings.find((entry) => entry.path === 'max')).toMatchObject({
      value: 6,
      written: { project: 6 },
    });
    expect(after.settings.find((entry) => entry.path === 'naming.enabled')).toMatchObject({
      value: false,
      globalValue: false,
    });
  });

  it('refuses the port of the panel on the project level', async () => {
    const h = await start();
    expect(await settings(h, { 'web.port': 8200 }, 'project')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    await expect(
      h.call('config_settings', {
        repository: h.repo,
        values: {},
        revision: null,
        level: 'global',
      }),
    ).rejects.toThrow();
  });

  it('writes the variable of a runtime without its value in the answer or the view', async () => {
    const h = await start();
    const result = await settings(h, { 'runtimes.claude.env.API_KEY': 'topsecret' }, 'global');
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain('topsecret');
    expect(JSON.stringify(await view(h))).not.toContain('topsecret');
    expect(readFileSync(globalFile(h), 'utf8')).toContain('API_KEY: topsecret');
  });
});

describe('config catalog', () => {
  it('lists skills of both levels and MCP servers without changing files', async () => {
    const home = mkdtempSync(join(tmpdir(), 'aip-home-'));
    mkdirSync(join(home, '.claude', 'skills', 'tdd'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'skills', 'tdd', 'SKILL.md'),
      '---\ndescription: Tests\n---\n',
    );
    const h = await harness(`${PIPELINE_CONFIG}  claude: { mcp: inherit }\n`, { HOME: home });
    current = h;
    mkdirSync(join(h.repo, '.claude', 'skills', 'local'), { recursive: true });
    writeFileSync(join(h.repo, '.claude', 'skills', 'local', 'SKILL.md'), '');
    writeFileSync(join(h.repo, '.mcp.json'), JSON.stringify({ mcpServers: { jira: {} } }));
    const before = readFileSync(coderFile(h), 'utf8');

    const catalog = (await h.call('config_catalog', {
      repository: h.repo,
    })) as ConfigCatalogResponse;

    expect(catalog.repository).toBe(h.repo);
    expect(catalog.mcpInherited).toBe(true);
    expect(catalog.runtimes.claude.skills.map((s) => `${s.source}:${s.name}`)).toEqual([
      'project:local',
      'global:tdd',
    ]);
    expect(catalog.runtimes.claude.tools.map((t) => t.name)).toContain('mcp__jira');
    expect(readFileSync(coderFile(h), 'utf8')).toBe(before);
  });
});

describe('shared specialists', () => {
  const sharedDir = (h: Harness) => join(h.repo, '..', 'xdg', 'aip');

  function put(path: string, text: string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }

  /** A second repository of the registry, with a project pipeline that needs the shared `qa`. */
  async function registryWithLib(h: Harness): Promise<string> {
    const lib = realpathSync(mkdtempSync(join(tmpdir(), 'aip-lib-')));
    execFileSync('git', ['init', '-q', '-b', 'main', lib]);
    put(
      join(lib, 'aip', 'pipelines', 'feature.yaml'),
      'steps:\n  - id: test\n    specialist: qa\n',
    );
    put(join(sharedDir(h), 'specialists', 'qa.yaml'), 'name: QA\n');
    put(join(sharedDir(h), 'specialists', 'writer.yaml'), 'name: Writer\n');
    // naming a repository registers it
    await h.call('config', { repository: lib });
    await view(h);
    return lib;
  }

  type Usage = {
    directory: string;
    specialists: {
      slug: string;
      projects: { repository: string; references: unknown[] }[];
      global: unknown[];
    }[];
  };

  it('reports the repositories of the registry that need each shared specialist', async () => {
    const h = await start();
    const lib = await registryWithLib(h);
    const usage = (await h.call('shared_specialists', {})) as Usage;
    expect(usage.directory).toBe(join(sharedDir(h), 'specialists'));
    expect(usage.specialists.map((entry) => entry.slug)).toEqual(['qa', 'writer']);
    const [qa, writer] = usage.specialists;
    expect(qa?.global).toEqual([]);
    expect(qa?.projects).toEqual([
      { repository: lib, references: [{ pipeline: 'feature', step: 'test' }] },
    ]);
    expect(writer?.projects).toEqual([]);
  });

  it('refuses to delete a shared specialist another repository needs', async () => {
    const h = await start();
    const lib = await registryWithLib(h);
    const qa = join(sharedDir(h), 'specialists', 'qa.yaml');
    const result = (await h.call('config_delete', {
      repository: h.repo,
      kind: 'specialist',
      id: 'qa',
      revision: revisionOf(readFileSync(qa, 'utf8'))!,
      level: 'global',
    })) as ConfigEditResult;
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid',
      references: [{ pipeline: 'feature', step: 'test', repository: lib }],
    });
    expect(existsSync(qa)).toBe(true);
  });

  it('deletes an unused shared specialist and lets a project override go', async () => {
    const h = await start();
    const lib = await registryWithLib(h);
    const writer = join(sharedDir(h), 'specialists', 'writer.yaml');
    const removed = (await h.call('config_delete', {
      repository: h.repo,
      kind: 'specialist',
      id: 'writer',
      revision: revisionOf(readFileSync(writer, 'utf8'))!,
      level: 'global',
    })) as ConfigEditResult;
    expect(removed.ok).toBe(true);
    expect(existsSync(writer)).toBe(false);

    // an override in the project makes the project independent of the shared file
    put(join(lib, 'aip', 'specialists', 'qa.yaml'), 'name: Own QA\n');
    const usage = (await h.call('shared_specialists', {})) as Usage;
    expect(usage.specialists.find((entry) => entry.slug === 'qa')?.projects).toEqual([]);
    const qa = join(sharedDir(h), 'specialists', 'qa.yaml');
    const gone = (await h.call('config_delete', {
      repository: h.repo,
      kind: 'specialist',
      id: 'qa',
      revision: revisionOf(readFileSync(qa, 'utf8'))!,
      level: 'global',
    })) as ConfigEditResult;
    expect(gone.ok).toBe(true);
  });
});

describe('shared pipelines', () => {
  const sharedDir = (h: Harness) => join(h.repo, '..', 'xdg', 'aip');

  function put(path: string, text: string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }

  async function registryWithLib(h: Harness): Promise<string> {
    const lib = realpathSync(mkdtempSync(join(tmpdir(), 'aip-lib-')));
    execFileSync('git', ['init', '-q', '-b', 'main', lib]);
    put(join(sharedDir(h), 'specialists', 'coder.yaml'), 'name: Coder\n');
    put(
      join(sharedDir(h), 'pipelines', 'explore.yaml'),
      'steps:\n  - id: code\n    specialist: coder\n',
    );
    put(
      join(sharedDir(h), 'pipelines', 'spare.yaml'),
      'steps:\n  - id: code\n    specialist: coder\n',
    );
    put(
      join(lib, 'aip', 'pipelines', 'epic.yaml'),
      'split:\n  specialist: coder\n  pipeline: explore\n',
    );
    await h.call('config', { repository: lib });
    await view(h);
    return lib;
  }

  type Usage = {
    directory: string;
    pipelines: { id: string; projects: { repository: string; references: unknown[] }[] }[];
  };

  const del = async (h: Harness, id: string, repository = h.repo) => {
    const file = join(sharedDir(h), 'pipelines', `${id}.yaml`);
    return (await h.call('config_delete', {
      repository,
      kind: 'pipeline',
      id,
      revision: revisionOf(readFileSync(file, 'utf8'))!,
      level: 'global',
    })) as ConfigEditResult;
  };

  it('reports the repositories that use each shared pipeline', async () => {
    const h = await start();
    const lib = await registryWithLib(h);
    const usage = (await h.call('shared_pipelines', {})) as Usage;
    expect(usage.directory).toBe(join(sharedDir(h), 'pipelines'));
    const explore = usage.pipelines.find((w) => w.id === 'explore');
    expect(explore?.projects).toEqual([
      { repository: lib, references: [{ pipeline: 'epic', split: true }] },
    ]);
    expect(usage.pipelines.find((w) => w.id === 'spare')?.projects).toEqual([]);
  });

  it('refuses to delete a shared pipeline another repository needs', async () => {
    const h = await start();
    const lib = await registryWithLib(h);
    expect(await del(h, 'explore')).toMatchObject({
      ok: false,
      reason: 'invalid',
      references: [{ pipeline: 'epic', split: true, repository: lib }],
    });
    // from the repository that holds the reference the draft check refuses it as well
    expect(await del(h, 'explore', lib)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(existsSync(join(sharedDir(h), 'pipelines', 'explore.yaml'))).toBe(true);
  });

  it('deletes an unused shared pipeline', async () => {
    const h = await start();
    await registryWithLib(h);
    expect((await del(h, 'spare')).ok).toBe(true);
    expect(existsSync(join(sharedDir(h), 'pipelines', 'spare.yaml'))).toBe(false);
  });

  it('imports project pipelines and refuses bad requests', async () => {
    const h = await start();
    const lib = await registryWithLib(h);
    const text = 'name: Mine\ntags: [x]\nsteps:\n  - id: code\n    specialist: coder\n';
    put(join(lib, 'aip', 'pipelines', 'mine.yaml'), text);
    put(join(lib, 'aip', 'pipelines', 'lost.yaml'), 'steps:\n  - id: s\n    specialist: nobody\n');
    const ok = await h.call('pipelines_import', { repository: h.repo, source: lib, ids: ['mine'] });
    expect(ok).toEqual({ ok: true, imported: ['mine'] });
    expect(readFileSync(join(h.repo, 'aip', 'pipelines', 'mine.yaml'), 'utf8')).toBe(text);
    expect(
      await h.call('pipelines_import', { repository: h.repo, source: lib, ids: ['mine'] }),
    ).toMatchObject({ ok: false, reason: 'conflict', ids: ['mine'] });
    expect(
      await h.call('pipelines_import', { repository: h.repo, source: lib, ids: ['lost'] }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    await expect(
      h.call('pipelines_import', { repository: h.repo, source: '/tmp/other', ids: ['mine'] }),
    ).rejects.toThrow(/unknown repository/);
    await expect(
      h.call('pipelines_import', { repository: h.repo, source: h.repo, ids: ['mine'] }),
    ).rejects.toThrow(/another repository/);
  });
});
