import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { revisionOf, type ConfigEditorView } from '../../src/config/index.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditResult,
  ConfigPreview,
  RunCreated,
} from '../../src/protocol/index.ts';

import { WORKFLOW_CONFIG, harness, startRun, type Harness } from './harness.ts';

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
      references: [{ workflow: 'feature', step: 'review' }],
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
      WORKFLOW_CONFIG.replace(
        'coder: { name: Кодировщик }',
        'coder: { name: Кодировщик, model: sonnet }',
      ),
    );
    h.script({ code: [{ exitCode: 1, noReport: true }, {}] });
    const first = (
      (await startRun(h, {
        repository: h.repo,
        workflow: 'feature',
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
        workflow: 'feature',
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

describe('workflow editing', () => {
  const featureFile = (h: Harness) => join(h.repo, 'aip', 'workflows', 'feature.yaml');
  const steps = [
    { id: 'code', specialist: 'coder' },
    { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 2 } },
  ];

  async function preview(h: Harness, value: Record<string, unknown>): Promise<ConfigPreview> {
    return (await h.call('config_preview', {
      repository: h.repo,
      kind: 'workflow',
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
        path: 'swarm.workflows.feature.steps[2].specialist',
        message: expect.stringContaining('known: coder, reviewer'),
      }),
    );
  });

  it('lists the workflows and writes one', async () => {
    const h = await start();
    const listed = await view(h);
    const feature = listed.workflows.find((workflow) => workflow.id === 'feature')!;
    expect(feature.level).toBe('project');
    const result = (await h.call('config_write', {
      repository: h.repo,
      kind: 'workflow',
      id: 'feature',
      value: { steps: steps.slice(0, 1) },
      revision: feature.revision,
    })) as ConfigEditResult;
    expect(result).toMatchObject({ ok: true, file: featureFile(h) });
    expect(readFileSync(featureFile(h), 'utf8')).toContain('code');
  });

  it('deletes a workflow while its run goes on, and refuses new runs of it', async () => {
    const h = await start();
    h.script({ code: [{ exitCode: 1, noReport: true }, {}] });
    const runId = (
      (await startRun(h, {
        repository: h.repo,
        workflow: 'feature',
        groups: [{ title: 'g1', task: 'task' }],
      })) as RunCreated
    ).runId;
    await h.waitFor(runId, (run) => run.groups[0]?.status === 'failed');
    const feature = (await view(h)).workflows.find((workflow) => workflow.id === 'feature')!;
    const deleted = await h.call('config_delete', {
      repository: h.repo,
      kind: 'workflow',
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
        workflow: 'feature',
        groups: [{ title: 'g2', task: 'task' }],
      }),
    ).rejects.toThrow(/unknown workflow `feature`/);
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

  it('previews a workflow draft on the global level', async () => {
    const h = await start();
    const preview = (await h.call('config_preview', {
      repository: h.repo,
      kind: 'workflow',
      id: 'feature',
      value: { steps: [{ id: 'code', specialist: 'coder' }] },
      level: 'global',
    })) as ConfigPreview;
    expect(preview.errors.map((error) => error.path)).toContain(
      'swarm.workflows.feature.steps[0].specialist',
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
      workflow: 'feature',
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
      workflow: 'feature',
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
    const h = await harness(`${WORKFLOW_CONFIG}  claude: { mcp: inherit }\n`, { HOME: home });
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
