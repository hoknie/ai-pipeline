import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigEditError,
  commitEdit,
  draftConfig,
  configPaths,
  editDocument,
  editSetting,
  editorView,
  entryFile,
  loadConfig,
  planEdit,
  planSetting,
  revisionOf,
  settingsFile,
  specialistReferences,
  type ConfigPaths,
  type EditPlan,
} from '../../src/config/index.ts';

function setup(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function specialistFile(paths: ConfigPaths, slug: string, level = paths.project): string {
  return join(level.directory, 'specialists', `${slug}.yaml`);
}

const CODER = [
  '# основной кодировщик',
  'name: Кодировщик',
  'model: sonnet # дешёвая модель',
  '',
  '# команды, которые можно запускать',
  'allow_commands:',
  "  - 'npm test*'",
  'prompt: |',
  '  Пиши код.',
  '  Задача: %s',
  '',
].join('\n');

function accepted(plan: EditPlan) {
  if (!plan.ok) throw new Error(`expected an accepted plan: ${JSON.stringify(plan)}`);
  return plan;
}

describe('editDocument', () => {
  it('keeps comments and key order when one value changes', () => {
    const text = editDocument(CODER, {
      name: 'Кодировщик',
      model: 'opus',
      allow_commands: ['npm test*'],
      prompt: 'Пиши код.\nЗадача: %s\n',
    });
    expect(text).toBe(CODER.replace('model: sonnet', 'model: opus'));
  });

  it('does not touch a file whose values did not change', () => {
    const value = {
      name: 'Кодировщик',
      model: 'sonnet',
      allow_commands: ['npm test*'],
      prompt: 'Пиши код.\nЗадача: %s\n',
    };
    expect(editDocument(CODER, value)).toBe(CODER);
  });

  it('removes a cleared key and appends a new one at the end', () => {
    const text = editDocument(CODER, {
      name: 'Кодировщик',
      allow_commands: ['npm test*'],
      prompt: 'Пиши код.\nЗадача: %s\n',
      timeout: '1h',
    });
    expect(text).not.toContain('model');
    expect(text.trimEnd().endsWith('timeout: 1h')).toBe(true);
    expect(text).toContain('# команды, которые можно запускать');
  });

  it('writes a multi-line prompt as a block literal', () => {
    const fresh = editDocument(undefined, { name: 'Автор', prompt: 'Первая\nВторая' });
    expect(fresh).toContain('prompt: |-');
    expect(fresh).toContain('  Первая\n  Вторая');
    const changed = editDocument('name: Автор\nprompt: x\n', {
      name: 'Автор',
      prompt: 'Первая\nВторая\n',
    });
    expect(changed).toContain('prompt: |\n  Первая\n  Вторая\n');
  });

  it('keeps long plain values unfolded', () => {
    const long = `${'слово '.repeat(40)}конец`;
    const text = editDocument(`name: A\ndescription: ${long}\n`, { name: 'B', description: long });
    expect(text).toContain(`description: ${long}`);
  });

  it('treats a mapping with the keys in another order as unchanged', () => {
    const text = 'steps:\n  # первый\n  - { specialist: coder, id: code }\n';
    expect(editDocument(text, { steps: [{ id: 'code', specialist: 'coder' }] })).toBe(text);
  });

  it('creates a new file from a value', () => {
    expect(editDocument(undefined, { name: 'Новый', max: 2 })).toBe('name: Новый\nmax: 2\n');
  });

  it('refuses a file with a syntax error', () => {
    expect(() => editDocument('name: [\n', { name: 'x' })).toThrow(ConfigEditError);
  });
});

describe('entryFile', () => {
  it('points into aip/specialists and rejects anything but a slug', () => {
    const paths = setup();
    expect(entryFile(paths, 'specialist', 'coder')).toBe(specialistFile(paths, 'coder'));
    for (const id of ['../settings', 'a/b', '', 'Coder', '.hidden']) {
      expect(() => entryFile(paths, 'specialist', id)).toThrow(/must match/);
    }
  });

  it('prefers an existing .yml file', () => {
    const paths = setup();
    const yml = join(paths.project.directory, 'specialists', 'coder.yml');
    write(yml, 'name: C\n');
    expect(entryFile(paths, 'specialist', 'coder')).toBe(yml);
  });
});

describe('split.workflow target', () => {
  it('refuses to delete a workflow another workflow splits into', () => {
    const paths = setup();
    write(specialistFile(paths, 'coder'), CODER);
    write(specialistFile(paths, 'plan'), 'name: Планировщик\n');
    const explore = join(paths.project.directory, 'workflows', 'explore.yaml');
    const epic = join(paths.project.directory, 'workflows', 'epic.yaml');
    const exploreText = 'steps:\n  - { id: research, specialist: coder }\n';
    write(explore, exploreText);
    write(epic, 'split: { specialist: plan, workflow: explore }\n');
    const plan = planEdit(paths, {
      kind: 'workflow',
      id: 'explore',
      value: null,
      revision: revisionOf(exploreText),
    });
    expect(plan).toMatchObject({ ok: false, reason: 'invalid' });
    if (plan.ok || plan.reason !== 'invalid') throw new Error('expected invalid');
    expect(plan.errors.map((error) => error.path)).toContain('swarm.workflows.epic.split.workflow');
    expect(readFileSync(explore, 'utf8')).toBe(exploreText);
  });
});

describe('planEdit and commitEdit', () => {
  function project(paths: ConfigPaths): void {
    write(specialistFile(paths, 'coder'), CODER);
    write(specialistFile(paths, 'reviewer'), 'name: Ревьюер\npermissions: read\n');
    write(
      join(paths.project.directory, 'workflows', 'feature.yaml'),
      'steps:\n  - { id: code, specialist: coder }\n  - { id: review, specialist: reviewer }\n',
    );
    write(join(paths.project.directory, 'settings.yaml'), 'delivery: { resolver: reviewer }\n');
  }

  it('writes a change and returns the new revision', () => {
    const paths = setup();
    project(paths);
    const file = specialistFile(paths, 'coder');
    const plan = accepted(
      planEdit(paths, {
        kind: 'specialist',
        id: 'coder',
        value: { name: 'Кодировщик', model: 'opus' },
        revision: revisionOf(CODER),
      }),
    );
    const done = commitEdit(plan);
    expect(done).toEqual({ file, revision: revisionOf(readFileSync(file, 'utf8')) });
    expect(loadConfig(paths).specialists.find((s) => s.slug === 'coder')?.model).toBe('opus');
  });

  it('rejects an invalid value and leaves the file as it was', () => {
    const paths = setup();
    project(paths);
    const plan = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'Кодировщик', permissions: 'admin' },
      revision: revisionOf(CODER),
    });
    expect(plan).toMatchObject({ ok: false, reason: 'invalid' });
    if (plan.ok || plan.reason !== 'invalid') throw new Error('expected invalid');
    expect(plan.errors).toContainEqual({
      file: specialistFile(paths, 'coder'),
      path: 'swarm.specialists.coder.permissions',
      message: expect.stringContaining('read, edit, full'),
    });
    expect(readFileSync(specialistFile(paths, 'coder'), 'utf8')).toBe(CODER);
  });

  it('is not stopped by an error somewhere else', () => {
    const paths = setup();
    project(paths);
    write(
      join(paths.project.directory, 'workflows', 'feature.yaml'),
      'steps:\n  - { id: code, specialist: nobody }\n',
    );
    const plan = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'Кодировщик', model: 'opus' },
      revision: revisionOf(CODER),
    });
    expect(plan.ok).toBe(true);
  });

  it('accepts the fix of an existing error', () => {
    const paths = setup();
    write(specialistFile(paths, 'coder'), 'name: C\nmax: 0\n');
    const plan = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'C', max: 2 },
      revision: revisionOf('name: C\nmax: 0\n'),
    });
    commitEdit(accepted(plan));
    expect(loadConfig(paths).specialists[0]?.max).toBe(2);
  });

  it('reports a conflict after an outside change, and for a taken slug', () => {
    const paths = setup();
    project(paths);
    const seen = revisionOf(CODER);
    writeFileSync(specialistFile(paths, 'coder'), `${CODER}# правка в редакторе\n`);
    const edit = { kind: 'specialist', id: 'coder', value: { name: 'C' }, revision: seen } as const;
    expect(planEdit(paths, edit)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(planEdit(paths, { ...edit, revision: null })).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('already exists'),
    });
    expect(planEdit(paths, { ...edit, id: 'gone', revision: seen })).toMatchObject({
      reason: 'conflict',
    });
    expect(readFileSync(specialistFile(paths, 'coder'), 'utf8')).toContain('правка в редакторе');
  });

  it('creates the directory for a new specialist', () => {
    const paths = setup();
    const plan = accepted(
      planEdit(paths, { kind: 'specialist', id: 'qa', value: { name: 'QA' }, revision: null }),
    );
    expect(existsSync(dirname(plan.file))).toBe(false);
    commitEdit(plan);
    expect(readFileSync(plan.file, 'utf8')).toBe('name: QA\n');
    expect(readdirTemp(dirname(plan.file))).toEqual(['qa.yaml']);
  });

  it('refuses to delete a specialist that is used and lists every reference', () => {
    const paths = setup();
    project(paths);
    const plan = planEdit(paths, {
      kind: 'specialist',
      id: 'reviewer',
      value: null,
      revision: revisionOf('name: Ревьюер\npermissions: read\n'),
    });
    expect(plan).toEqual({
      ok: false,
      reason: 'invalid',
      errors: [],
      references: [{ workflow: 'feature', step: 'review' }, { field: 'delivery.resolver' }],
    });
    expect(existsSync(specialistFile(paths, 'reviewer'))).toBe(true);
  });

  it('deletes an unused specialist, and an override that has a global one below', () => {
    const paths = setup();
    project(paths);
    write(specialistFile(paths, 'extra'), 'name: Extra\n');
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'specialist',
          id: 'extra',
          value: null,
          revision: revisionOf('name: Extra\n'),
        }),
      ),
    );
    expect(existsSync(specialistFile(paths, 'extra'))).toBe(false);
    write(specialistFile(paths, 'coder', paths.global), 'name: Общий\n');
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'specialist',
          id: 'coder',
          value: null,
          revision: revisionOf(CODER),
        }),
      ),
    );
    expect(loadConfig(paths).specialists.find((s) => s.slug === 'coder')?.name).toBe('Общий');
  });

  it('never touches the global level', () => {
    const paths = setup();
    write(specialistFile(paths, 'qa', paths.global), 'name: Общий QA\n');
    const plan = accepted(
      planEdit(paths, {
        kind: 'specialist',
        id: 'qa',
        value: { name: 'Общий QA' },
        revision: null,
      }),
    );
    commitEdit(plan);
    expect(plan.file).toBe(specialistFile(paths, 'qa'));
    expect(readFileSync(specialistFile(paths, 'qa', paths.global), 'utf8')).toBe(
      'name: Общий QA\n',
    );
  });
});

function readdirTemp(directory: string): string[] {
  return readdirSync(directory);
}

describe('specialistReferences', () => {
  it('finds steps, split and delivery fields', () => {
    const tree = {
      swarm: {
        workflows: {
          a: { split: { specialist: 'plan' }, steps: [{ id: 'one', specialist: 'plan' }] },
          b: { steps: [{ id: 'x', specialist: 'other' }] },
        },
        delivery: { message_specialist: 'plan' },
      },
    };
    expect(specialistReferences(tree, 'plan')).toEqual([
      { workflow: 'a', split: true },
      { workflow: 'a', step: 'one' },
      { field: 'delivery.message_specialist' },
    ]);
  });
});

describe('editorView', () => {
  it('shows the project over the global level and where each setting comes from', () => {
    const paths = setup();
    write(specialistFile(paths, 'coder', paths.global), 'name: Общий\nmodel: a\n');
    write(specialistFile(paths, 'qa', paths.global), 'name: QA\n');
    write(specialistFile(paths, 'coder'), 'name: Проектный\nmodel: b\n');
    write(specialistFile(paths, 'plan'), 'name: План\n');
    write(join(paths.global.directory, 'settings.yaml'), 'max: 5\n');
    write(join(paths.project.directory, 'settings.yaml'), 'delivery: { auto: false }\n');
    const view = editorView(paths);
    expect(view.errors).toEqual([]);
    const byLevel = Object.fromEntries(view.specialists.map((s) => [s.slug, s.level]));
    expect(byLevel).toEqual({ coder: 'project_over_global', plan: 'project', qa: 'global' });
    const coder = view.specialists.find((s) => s.slug === 'coder');
    expect(coder?.file).toBe(specialistFile(paths, 'coder'));
    expect(coder?.effective?.model).toBe('b');
    expect(coder?.revision).toBe(revisionOf('name: Проектный\nmodel: b\n'));
    const qa = view.specialists.find((s) => s.slug === 'qa');
    expect(qa).toMatchObject({ file: specialistFile(paths, 'qa', paths.global), revision: null });
    const max = view.settings.find((setting) => setting.path === 'max');
    expect(max).toEqual({
      path: 'max',
      value: 5,
      file: join(paths.global.directory, 'settings.yaml'),
    });
    expect(view.settings.find((setting) => setting.path === 'delivery.auto')).toMatchObject({
      value: false,
      file: join(paths.project.directory, 'settings.yaml'),
    });
    expect(view.settings.find((setting) => setting.path === 'delivery.mode')).toMatchObject({
      value: 'worktree',
      file: null,
    });
  });

  it('keeps every specialist when the configuration has errors', () => {
    const paths = setup();
    write(specialistFile(paths, 'coder'), 'name: C\n');
    write(specialistFile(paths, 'broken'), 'name: B\nmax: 0\n');
    write(specialistFile(paths, 'syntax'), 'name: [\n');
    write(
      join(paths.project.directory, 'workflows', 'feature.yaml'),
      'steps:\n  - { id: code, specialist: nobody }\n',
    );
    const view = editorView(paths);
    expect(view.specialists.map((s) => s.slug)).toEqual(['broken', 'coder']);
    expect(view.specialists.find((s) => s.slug === 'broken')?.effective).toBeNull();
    expect(view.specialists.find((s) => s.slug === 'coder')?.effective?.name).toBe('C');
    expect(view.errors).toContainEqual(
      expect.objectContaining({
        file: join(paths.project.directory, 'workflows', 'feature.yaml'),
        path: 'swarm.workflows.feature.steps[0].specialist',
      }),
    );
    expect(view.errors.some((error) => error.file === specialistFile(paths, 'syntax'))).toBe(true);
  });
});

describe('workflow entries', () => {
  const FEATURE = [
    'steps:',
    '  - { id: code, specialist: coder }',
    '  - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 } }',
    '',
  ].join('\n');
  const WITH_SPLIT = `# деление на группы\nsplit: { specialist: coder, max_groups: 3 }\n${FEATURE}`;

  function project(paths: ConfigPaths, text = FEATURE): void {
    write(specialistFile(paths, 'coder'), 'name: Кодировщик\n');
    write(specialistFile(paths, 'reviewer'), 'name: Ревьюер\npermissions: read\n');
    write(join(paths.project.directory, 'workflows', 'feature.yaml'), text);
  }

  const workflowFile = (paths: ConfigPaths) =>
    join(paths.project.directory, 'workflows', 'feature.yaml');

  const steps = [
    { id: 'code', specialist: 'coder' },
    { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 2 } },
  ];

  it('points into aip/workflows and checks the id as a slug', () => {
    const paths = setup();
    expect(entryFile(paths, 'workflow', 'feature')).toBe(workflowFile(paths));
    expect(() => entryFile(paths, 'workflow', '../x')).toThrow(/must match/);
  });

  it('keeps the comment over split when only steps change', () => {
    const paths = setup();
    project(paths, WITH_SPLIT);
    const plan = accepted(
      planEdit(paths, {
        kind: 'workflow',
        id: 'feature',
        value: {
          split: { specialist: 'coder', max_groups: 3 },
          steps: [...steps, { id: 'docs', specialist: 'coder' }],
        },
        revision: revisionOf(WITH_SPLIT),
      }),
    );
    commitEdit(plan);
    const text = readFileSync(workflowFile(paths), 'utf8');
    expect(
      text.startsWith('# деление на группы\nsplit: { specialist: coder, max_groups: 3 }'),
    ).toBe(true);
    expect(loadConfig(paths).workflows[0]?.steps.map((step) => step.id)).toEqual([
      'code',
      'review',
      'docs',
    ]);
  });

  it('rejects a return to a later step with the path of goto and keeps the file', () => {
    const paths = setup();
    project(paths);
    const plan = planEdit(paths, {
      kind: 'workflow',
      id: 'feature',
      value: {
        steps: [
          { id: 'code', specialist: 'coder', on_reject: { goto: 'review', max_rounds: 2 } },
          { id: 'review', specialist: 'reviewer' },
        ],
      },
      revision: revisionOf(FEATURE),
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.workflows.feature.steps[0].on_reject.goto' }],
    });
    expect(readFileSync(workflowFile(paths), 'utf8')).toBe(FEATURE);
  });

  it('reports a conflict, creates a workflow and deletes without references', () => {
    const paths = setup();
    project(paths);
    const edit = { kind: 'workflow', id: 'feature', value: { steps }, revision: 'stale' } as const;
    expect(planEdit(paths, edit)).toMatchObject({ ok: false, reason: 'conflict' });
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'workflow',
          id: 'quick',
          value: { steps: [{ id: 'code', specialist: 'coder' }] },
          revision: null,
        }),
      ),
    );
    expect(loadConfig(paths).workflows.map((workflow) => workflow.id)).toEqual([
      'feature',
      'quick',
    ]);
    const quick = join(paths.project.directory, 'workflows', 'quick.yaml');
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'workflow',
          id: 'quick',
          value: null,
          revision: revisionOf(readFileSync(quick, 'utf8')),
        }),
      ),
    );
    expect(existsSync(quick)).toBe(false);
  });

  it('gives the global workflow back when the project file is deleted', () => {
    const paths = setup();
    project(paths);
    write(
      join(paths.global.directory, 'workflows', 'feature.yaml'),
      'steps:\n  - { id: only, specialist: coder }\n',
    );
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'workflow',
          id: 'feature',
          value: null,
          revision: revisionOf(FEATURE),
        }),
      ),
    );
    expect(loadConfig(paths).workflows[0]?.steps.map((step) => step.id)).toEqual(['only']);
  });

  it('draftConfig shows the configuration without touching files, and agrees with planEdit', () => {
    const paths = setup();
    project(paths);
    const good = draftConfig(paths, {
      kind: 'workflow',
      id: 'feature',
      value: { steps: [...steps, { id: 'docs', specialist: 'coder' }] },
    });
    expect(good.errors).toEqual([]);
    expect(good.config?.workflows[0]?.steps).toHaveLength(3);
    expect(readFileSync(workflowFile(paths), 'utf8')).toBe(FEATURE);
    const value = { steps: [{ id: 'code', specialist: 'reviewr' }] };
    const bad = draftConfig(paths, { kind: 'workflow', id: 'feature', value });
    expect(bad.config).toBeNull();
    const plan = planEdit(paths, {
      kind: 'workflow',
      id: 'feature',
      value,
      revision: revisionOf(FEATURE),
    });
    expect(plan).toMatchObject({ ok: false, errors: bad.errors });
    expect(bad.errors[0]?.message).toContain('known: coder, reviewer');
  });

  it('lists the workflows with their levels in the editor view', () => {
    const paths = setup();
    project(paths);
    write(
      join(paths.global.directory, 'workflows', 'quick.yaml'),
      'steps:\n  - { id: a, specialist: coder }\n',
    );
    write(join(paths.global.directory, 'workflows', 'feature.yaml'), FEATURE);
    const view = editorView(paths);
    expect(view.workflows.map((workflow) => [workflow.id, workflow.level])).toEqual([
      ['feature', 'project_over_global'],
      ['quick', 'global'],
    ]);
    expect(view.workflows[0]).toMatchObject({
      file: workflowFile(paths),
      revision: revisionOf(FEATURE),
    });
    expect(view.workflows[1]?.revision).toBeNull();
  });
});

describe('global level', () => {
  const FEATURE = [
    'steps:',
    '  - { id: code, specialist: coder }',
    '  - { id: review, specialist: reviewer }',
    '',
  ].join('\n');
  const globalSpecialist = (paths: ConfigPaths, slug: string) =>
    specialistFile(paths, slug, paths.global);
  const globalWorkflow = (paths: ConfigPaths, id = 'feature') =>
    join(paths.global.directory, 'workflows', `${id}.yaml`);

  it('points entryFile into the global directory and rejects bad slugs on both levels', () => {
    const paths = setup();
    expect(entryFile(paths, 'specialist', 'qa', 'global')).toBe(globalSpecialist(paths, 'qa'));
    expect(entryFile(paths, 'specialist', 'qa')).toBe(specialistFile(paths, 'qa'));
    for (const level of ['project', 'global'] as const) {
      expect(() => entryFile(paths, 'specialist', '../settings', level)).toThrow(ConfigEditError);
    }
  });

  it('creates the global file and directory and leaves the project alone', () => {
    const paths = setup();
    write(specialistFile(paths, 'coder'), 'name: Проект\n');
    const plan = accepted(
      planEdit(paths, {
        kind: 'specialist',
        id: 'qa',
        value: { name: 'QA' },
        revision: null,
        level: 'global',
      }),
    );
    expect(plan.file).toBe(globalSpecialist(paths, 'qa'));
    commitEdit(plan);
    expect(readFileSync(globalSpecialist(paths, 'qa'), 'utf8')).toContain('name: QA');
    expect(readdirSync(join(paths.project.directory, 'specialists'))).toEqual(['coder.yaml']);
  });

  it('rejects a global workflow that names a project-only specialist', () => {
    const paths = setup();
    write(globalSpecialist(paths, 'reviewer'), 'name: R\n');
    write(specialistFile(paths, 'coder'), 'name: Проект\n');
    const plan = planEdit(paths, {
      kind: 'workflow',
      id: 'feature',
      value: { steps: [{ id: 'code', specialist: 'coder' }] },
      revision: null,
      level: 'global',
    });
    expect(plan.ok).toBe(false);
    if (plan.ok || plan.reason !== 'invalid') throw new Error('expected invalid');
    expect(plan.errors.map((error) => error.path)).toContain(
      'swarm.workflows.feature.steps[0].specialist',
    );
    expect(existsSync(globalWorkflow(paths))).toBe(false);
    const sameInProject = planEdit(paths, {
      kind: 'workflow',
      id: 'feature',
      value: { steps: [{ id: 'code', specialist: 'coder' }] },
      revision: null,
    });
    expect(sameInProject.ok).toBe(true);
  });

  it('does not let an existing global error block an unrelated edit', () => {
    const paths = setup();
    write(globalSpecialist(paths, 'coder'), 'name: C\n');
    write(globalWorkflow(paths, 'broken'), 'steps:\n  - { id: a, specialist: ghost }\n');
    write(specialistFile(paths, 'ghost'), 'name: G\n');
    const plan = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'C2' },
      revision: revisionOf('name: C\n'),
      level: 'global',
    });
    expect(plan.ok).toBe(true);
  });

  it('reports a revision conflict of the global file', () => {
    const paths = setup();
    write(globalSpecialist(paths, 'coder'), 'name: C\n');
    const plan = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'C2' },
      revision: revisionOf('name: other\n'),
      level: 'global',
    });
    expect(plan).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('refuses to delete a global specialist the global level uses, even with a project one', () => {
    const paths = setup();
    write(globalSpecialist(paths, 'coder'), 'name: C\n');
    write(globalSpecialist(paths, 'reviewer'), 'name: R\n');
    write(globalWorkflow(paths), FEATURE);
    write(specialistFile(paths, 'coder'), 'name: Проект\n');
    const plan = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: null,
      revision: revisionOf('name: C\n'),
      level: 'global',
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      references: [{ workflow: 'feature', step: 'code' }],
    });
    write(globalWorkflow(paths), 'steps:\n  - { id: only, specialist: reviewer }\n');
    const free = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: null,
      revision: revisionOf('name: C\n'),
      level: 'global',
    });
    expect(free.ok).toBe(true);
  });

  it('deletes a global workflow under a project one and keeps the project one', () => {
    const paths = setup();
    write(globalSpecialist(paths, 'coder'), 'name: C\n');
    write(globalSpecialist(paths, 'reviewer'), 'name: R\n');
    write(globalWorkflow(paths), FEATURE);
    const projectText = 'steps:\n  - { id: one, specialist: coder }\n';
    write(join(paths.project.directory, 'workflows', 'feature.yaml'), projectText);
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'workflow',
          id: 'feature',
          value: null,
          revision: revisionOf(FEATURE),
          level: 'global',
        }),
      ),
    );
    expect(existsSync(globalWorkflow(paths))).toBe(false);
    expect(loadConfig(paths).workflows[0]?.steps.map((step) => step.id)).toEqual(['one']);
  });

  it('shows the files of both levels in sources', () => {
    const paths = setup();
    write(globalSpecialist(paths, 'coder'), 'name: Общий\n');
    write(specialistFile(paths, 'coder'), 'name: Проект\n');
    write(globalSpecialist(paths, 'qa'), 'name: QA\n');
    const view = editorView(paths);
    const coder = view.specialists.find((entry) => entry.slug === 'coder')!;
    expect(coder.sources.project).toEqual({
      file: specialistFile(paths, 'coder'),
      revision: revisionOf('name: Проект\n'),
      raw: { name: 'Проект' },
    });
    expect(coder.sources.global?.revision).toBe(revisionOf('name: Общий\n'));
    expect(coder.sources.global?.raw).toEqual({ name: 'Общий' });
    const qa = view.specialists.find((entry) => entry.slug === 'qa')!;
    expect(qa.sources.project).toBeUndefined();
    expect(qa.sources.global?.file).toBe(globalSpecialist(paths, 'qa'));
    expect(qa.revision).toBeNull();
  });

  it('previews a global workflow under a project one with the draft steps', () => {
    const paths = setup();
    write(globalSpecialist(paths, 'coder'), 'name: C\n');
    write(
      join(paths.project.directory, 'workflows', 'feature.yaml'),
      'steps:\n  - { id: one, specialist: coder }\n',
    );
    const draft = draftConfig(paths, {
      kind: 'workflow',
      id: 'feature',
      value: {
        steps: [
          { id: 'a', specialist: 'coder' },
          { id: 'b', specialist: 'coder' },
        ],
      },
      level: 'global',
    });
    expect(draft.errors).toEqual([]);
    expect(draft.config?.workflows[0]?.steps.map((step) => step.id)).toEqual(['a', 'b']);
  });
});

describe('general settings', () => {
  function levels(globalText: string | null, projectText = 'delivery: { resolver: reviewer }\n') {
    const paths = setup();
    write(specialistFile(paths, 'reviewer'), 'name: Ревьюер\npermissions: read\n');
    write(specialistFile(paths, 'coder'), 'name: Кодировщик\n');
    write(
      join(paths.project.directory, 'workflows', 'feature.yaml'),
      'steps:\n  - { id: code, specialist: coder }\n',
    );
    write(join(paths.project.directory, 'settings.yaml'), projectText);
    if (globalText !== null) write(join(paths.global.directory, 'settings.yaml'), globalText);
    return paths;
  }
  const GLOBAL = '# общие\nmax: 5 # параллельно\ndelivery:\n  mode: commit\n';

  it('sets one field and keeps comments and the other keys', () => {
    expect(editSetting(GLOBAL, 'delivery.auto', false)).toBe(
      '# общие\nmax: 5 # параллельно\ndelivery:\n  mode: commit\n  auto: false\n',
    );
  });

  it('creates the text of an empty file, and removes a field with its empty section', () => {
    expect(editSetting(undefined, 'delivery.auto', false)).toBe('delivery:\n  auto: false\n');
    expect(editSetting('delivery:\n  auto: false\nmax: 5\n', 'delivery.auto', null)).toBe(
      'max: 5\n',
    );
    expect(editSetting('delivery:\n  auto: false\n  mode: commit\n', 'delivery.auto', null)).toBe(
      'delivery:\n  mode: commit\n',
    );
    expect(() => editSetting('a: [', 'delivery.auto', true)).toThrow(ConfigEditError);
  });

  it('writes delivery.auto to the global file and the configuration reads it', () => {
    const paths = levels(GLOBAL);
    const file = settingsFile(paths, 'global');
    expect(file).toBe(join(paths.global.directory, 'settings.yaml'));
    const plan = accepted(
      planSetting(paths, { path: 'delivery.auto', value: false, revision: revisionOf(GLOBAL) }),
    );
    commitEdit(plan);
    expect(readFileSync(file, 'utf8')).toContain('max: 5 # параллельно');
    expect(loadConfig(paths).delivery.auto).toBe(false);
    expect(loadConfig(paths).max).toBe(5);
  });

  it('creates the file when the revision is null', () => {
    const paths = levels(null);
    const plan = accepted(
      planSetting(paths, { path: 'delivery.auto', value: false, revision: null }),
    );
    commitEdit(plan);
    expect(readFileSync(settingsFile(paths, 'global'), 'utf8')).toBe('delivery:\n  auto: false\n');
  });

  it('reports a conflict for an old revision', () => {
    const paths = levels(GLOBAL);
    expect(
      planSetting(paths, { path: 'delivery.auto', value: false, revision: 'old' }),
    ).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    expect(
      planSetting(paths, { path: 'delivery.auto', value: false, revision: null }),
    ).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
  });

  it('removes the field with null and leaves the other fields of the section', () => {
    const text = 'delivery:\n  auto: false\n  mode: commit\n';
    const paths = levels(text);
    commitEdit(
      accepted(
        planSetting(paths, { path: 'delivery.auto', value: null, revision: revisionOf(text) }),
      ),
    );
    expect(readFileSync(settingsFile(paths, 'global'), 'utf8')).toBe('delivery:\n  mode: commit\n');
    expect(loadConfig(paths).delivery.auto).toBe(true);
  });

  it('refuses a path outside the list and names the allowed ones', () => {
    const paths = levels(GLOBAL);
    expect(() => planSetting(paths, { path: 'max', value: true, revision: null })).toThrow(
      /delivery\.auto/,
    );
  });

  it('shows the files and revisions of both levels in the editor view', () => {
    const paths = levels(GLOBAL);
    const view = editorView(paths);
    expect(view.settingsFiles.global).toEqual({
      file: join(paths.global.directory, 'settings.yaml'),
      revision: revisionOf(GLOBAL),
    });
    expect(view.settingsFiles.project.revision).toBe(
      revisionOf('delivery: { resolver: reviewer }\n'),
    );
    expect(editorView(setup()).settingsFiles.global.revision).toBeNull();
  });
});
