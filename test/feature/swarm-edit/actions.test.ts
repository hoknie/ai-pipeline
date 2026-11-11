import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigLoadError,
  findAction,
  withConfigDefaults,
  pipelineActionIds,
  type ConfigPaths,
  type FieldError,
  type LevelPaths,
} from '../../../src/feature/swarm-config/types/index.ts';
import {
  actionReferences,
  editorView,
  entryFile,
  planEdit,
  revisionOf,
} from '../../../src/feature/swarm-edit/services/index.ts';
import {
  configPaths,
  loadConfig,
  loadConfigSources,
  parseConfig,
} from '../../../src/feature/swarm-config/services/index.ts';
import { writeLevelDirectory } from '../../fixtures/config.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-actions-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function writeLevel(level: LevelPaths, text: string): void {
  writeLevelDirectory(level.directory, text);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function errorsOf(text: string): FieldError[] {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigLoadError && error.detail.kind === 'invalid') {
      return error.detail.errors;
    }
    throw error;
  }
  throw new Error('expected field errors');
}

function expectError(errors: FieldError[], path: string, fragment: string): void {
  expect(errors).toContainEqual({ path, message: expect.stringContaining(fragment) });
}

const BASE = `swarm:
  specialists:
    coder: { name: Кодировщик }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;

function withSwarm(extra: string, base = BASE): string {
  return base.replace('swarm:\n', `swarm:\n${extra}`);
}

describe('the description of an action', () => {
  it('reads a command with the defaults', () => {
    const config = parseConfig(
      withSwarm('  actions:\n    commit: { run: git commit -am "$AIP_COMMIT_MESSAGE" }\n'),
    );
    expect(findAction(config, 'commit')).toEqual({
      id: 'commit',
      name: null,
      run: 'git commit -am "$AIP_COMMIT_MESSAGE"',
      specialist: null,
      additionalPrompt: null,
      timeoutSeconds: 600,
      onFailure: 'stop',
      level: 'project',
    });
  });

  it('reads a specialist with all fields', () => {
    const config = parseConfig(
      withSwarm(
        '  actions:\n    notes: { name: Заметки, specialist: coder, additional_prompt: Кратко, on_failure: continue }\n',
      ),
    );
    expect(findAction(config, 'notes')).toMatchObject({
      name: 'Заметки',
      run: null,
      specialist: 'coder',
      additionalPrompt: 'Кратко',
      onFailure: 'continue',
    });
  });

  it('has no actions and no points by default', () => {
    const config = parseConfig(BASE);
    expect(config.actions).toEqual([]);
    expect(config.stages).toEqual({});
  });

  it('requires exactly one of run and specialist', () => {
    const both = errorsOf(
      withSwarm('  actions:\n    check: { run: npm test, specialist: coder }\n'),
    );
    expectError(both, 'swarm.actions.check', 'exactly one');
    const none = errorsOf(withSwarm('  actions:\n    check: { name: Проверка }\n'));
    expectError(none, 'swarm.actions.check', 'one of `run` and `specialist`');
  });

  it('names the known specialists for an unknown one', () => {
    const errors = errorsOf(withSwarm('  actions:\n    check: { specialist: qa }\n'));
    expectError(errors, 'swarm.actions.check.specialist', 'unknown specialist `qa`; known: coder');
  });

  it('checks the id, the empty values and the unknown keys', () => {
    const errors = errorsOf(
      withSwarm(
        '  actions:\n    Bad_Id: { run: a }\n    empty: { run: "  " }\n    extra: { run: a, color: red }\n',
      ),
    );
    expectError(errors, 'swarm.actions.Bad_Id', 'id must match');
    expectError(errors, 'swarm.actions.empty.run', 'must not be empty');
    expectError(errors, 'swarm.actions.extra.color', 'unknown key');
  });

  it('allows the timeout only for a command, and the prompt only for a specialist', () => {
    const errors = errorsOf(
      withSwarm(
        '  actions:\n    a: { specialist: coder, timeout: 5 }\n    b: { run: x, additional_prompt: text }\n',
      ),
    );
    expectError(errors, 'swarm.actions.a.timeout', 'only with `run`');
    expectError(errors, 'swarm.actions.b.additional_prompt', 'only with `specialist`');
  });

  it('checks the timeout and on_failure', () => {
    const errors = errorsOf(
      withSwarm(
        '  actions:\n    a: { run: x, timeout: 0 }\n    b: { run: x, on_failure: retry }\n',
      ),
    );
    expectError(errors, 'swarm.actions.a.timeout', 'must be an integer from 1');
    expectError(errors, 'swarm.actions.b.on_failure', 'must be one of stop, continue');
    expect(
      findAction(parseConfig(withSwarm('  actions:\n    a: { run: x, timeout: 90 }\n')), 'a')
        ?.timeoutSeconds,
    ).toBe(90);
  });
});

describe('the points of the pipeline', () => {
  const ACTIONS =
    '  actions:\n    prep: { run: a }\n    commit: { run: b }\n    check: { run: c }\n';

  it('reads swarm.stages', () => {
    const config = parseConfig(
      withSwarm(
        `${ACTIONS}  stages:\n    before_delivery: [check]\n    after_delivery: [commit]\n`,
      ),
    );
    expect(config.stages).toEqual({ before_delivery: ['check'], after_delivery: ['commit'] });
  });

  it('names the known actions for an unknown one', () => {
    const errors = errorsOf(withSwarm(`${ACTIONS}  stages:\n    after_split: [prep, nope]\n`));
    expectError(
      errors,
      'swarm.stages.after_split[1]',
      'unknown action `nope`; known: prep, commit, check',
    );
  });

  it('rejects repeats, unknown points and non-lists', () => {
    const errors = errorsOf(
      withSwarm(
        `${ACTIONS}  stages:\n    before_delivery: [check, check]\n    after_split: prep\n    middle: [prep]\n`,
      ),
    );
    expectError(errors, 'swarm.stages.before_delivery[1]', 'duplicate action');
    expectError(errors, 'swarm.stages.after_split', 'must be a list');
    expectError(errors, 'swarm.stages.middle', 'unknown key');
  });

  it('rejects a specialist after delivery', () => {
    const errors = errorsOf(
      withSwarm(
        '  actions:\n    notes: { specialist: coder }\n  stages:\n    after_delivery: [notes]\n',
      ),
    );
    expectError(errors, 'swarm.stages.after_delivery[0]', 'only commands');
  });

  it('allows a specialist in the other points', () => {
    const config = parseConfig(
      withSwarm(
        '  actions:\n    notes: { specialist: coder }\n  stages:\n    before_delivery: [notes]\n',
      ),
    );
    expect(config.stages.before_delivery).toEqual(['notes']);
  });

  const PIPELINES = (stages: string, split = true) => `swarm:
  specialists:
    coder: { name: Кодировщик }
  actions:
    prep: { run: a }
    commit: { run: b }
  stages:
    before_split: [prep]
    after_delivery: [commit]
  pipelines:
    docs:
${split ? '      split: { specialist: coder }\n' : ''}${stages}      steps:
        - { id: code, specialist: coder }
`;

  it('lets a pipeline replace a point, and an empty list disables it', () => {
    const config = parseConfig(PIPELINES('      stages: { after_delivery: [] }\n'));
    const docs = config.pipelines[0]!;
    expect(docs.stages).toEqual({ after_delivery: [] });
    expect(pipelineActionIds(config, docs, 'after_delivery')).toEqual([]);
    expect(pipelineActionIds(config, docs, 'before_split')).toEqual(['prep']);
  });

  it('takes the shared points for a pipeline without its own', () => {
    const config = parseConfig(PIPELINES(''));
    expect(pipelineActionIds(config, config.pipelines[0]!, 'after_delivery')).toEqual(['commit']);
  });

  it('skips the shared points around the split in a pipeline without a split', () => {
    const config = parseConfig(PIPELINES('', false));
    expect(pipelineActionIds(config, config.pipelines[0]!, 'before_split')).toEqual([]);
    expect(pipelineActionIds(config, config.pipelines[0]!, 'after_delivery')).toEqual(['commit']);
  });

  it('rejects the points around the split in a pipeline without a split', () => {
    const errors = errorsOf(PIPELINES('      stages: { before_split: [prep] }\n', false));
    expectError(
      errors,
      'swarm.pipelines.docs.stages.before_split',
      'only in a pipeline with `split`',
    );
  });

  it('checks the actions of a pipeline like the shared ones', () => {
    const errors = errorsOf(PIPELINES('      stages: { after_split: [missing] }\n'));
    expectError(errors, 'swarm.pipelines.docs.stages.after_split[0]', 'unknown action `missing`');
  });
});

describe('delivery prompts', () => {
  it('are absent by default', () => {
    const { delivery } = parseConfig(BASE);
    expect(delivery.messagePrompt).toBeUndefined();
    expect(delivery.resolverPrompt).toBeUndefined();
  });

  it('are read and merged field by field', () => {
    const config = parseConfig(
      withSwarm('  delivery: { message_prompt: По-русски, resolver_prompt: Сохраняй правки }\n'),
    );
    expect(config.delivery).toMatchObject({
      messagePrompt: 'По-русски',
      resolverPrompt: 'Сохраняй правки',
    });
  });

  it('must be non-empty strings', () => {
    const errors = errorsOf(withSwarm('  delivery: { message_prompt: "", resolver_prompt: 3 }\n'));
    expectError(errors, 'swarm.delivery.message_prompt', 'must not be empty');
    expectError(errors, 'swarm.delivery.resolver_prompt', 'must be a string');
  });
});

describe('levels', () => {
  it('reads actions/<id>.yaml of both levels, the project one overriding by id', () => {
    const paths = temporaryPaths();
    writeLevel(paths.global, BASE);
    writeLevel(paths.project, BASE);
    write(join(paths.global.directory, 'actions', 'commit.yaml'), 'run: shared\n');
    write(join(paths.global.directory, 'actions', 'lint.yaml'), 'run: lint\n');
    write(join(paths.project.directory, 'actions', 'commit.yaml'), 'run: project\ntimeout: 5\n');
    const config = loadConfig(paths);
    expect(config.actions.map((action) => [action.id, action.run, action.level])).toEqual([
      ['commit', 'project', 'project'],
      ['lint', 'lint', 'global'],
    ]);
    expect(findAction(config, 'commit')?.timeoutSeconds).toBe(5);
  });

  it('merges swarm.stages by point between the levels', () => {
    const paths = temporaryPaths();
    const actions = '  actions:\n    a: { run: x }\n    b: { run: y }\n';
    writeLevel(
      paths.global,
      withSwarm(`${actions}  stages:\n    before_delivery: [a]\n    after_delivery: [a]\n`),
    );
    writeLevel(paths.project, withSwarm('  stages:\n    after_delivery: [b]\n'));
    expect(loadConfig(paths).stages).toEqual({ before_delivery: ['a'], after_delivery: ['b'] });
  });

  it('reports the file of a broken action', () => {
    const paths = temporaryPaths();
    writeLevel(paths.project, BASE);
    const file = join(paths.project.directory, 'actions', 'bad.yaml');
    write(file, 'name: x\n');
    try {
      loadConfig(paths);
      throw new Error('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigLoadError);
      const detail = (error as ConfigLoadError).detail;
      expect(detail.kind === 'invalid' && detail.errors).toContainEqual({
        file,
        path: 'swarm.actions.bad',
        message: expect.stringContaining('one of `run` and `specialist`'),
      });
    }
  });

  it('refuses an actions key in settings.yaml', () => {
    const paths = temporaryPaths();
    writeLevel(paths.project, BASE);
    write(join(paths.project.directory, 'settings.yaml'), 'actions:\n  a: { run: x }\n');
    expect(() => loadConfig(paths)).toThrow(/actions are files of the actions\/ directory/);
  });

  it('lists the action files among the files read', () => {
    const paths = temporaryPaths();
    writeLevel(paths.project, BASE);
    const file = join(paths.project.directory, 'actions', 'commit.yaml');
    write(file, 'run: x\n');
    expect(loadConfigSources(paths).files).toContain(file);
  });
});

describe('a stored configuration', () => {
  it('gets empty actions and points when it was saved before they existed', () => {
    const stored = structuredClone(parseConfig(BASE)) as unknown as Record<string, unknown>;
    delete stored.actions;
    delete stored.stages;
    const read = withConfigDefaults(stored as never);
    expect(read.actions).toEqual([]);
    expect(read.stages).toEqual({});
    expect(read.delivery.messagePrompt).toBeUndefined();
  });

  it('keeps a string run of an older snapshot', () => {
    const config = parseConfig(
      withSwarm('  actions:\n    a: { run: x }\n  stages:\n    after_delivery: [a]\n'),
    );
    const stored = structuredClone(config) as unknown as { actions: { run: unknown }[] };
    stored.actions[0]!.run = 'echo x';
    const read = withConfigDefaults(stored as never);
    expect(read.actions[0]?.run).toBe('echo x');
  });

  it('keeps the actions of a newer snapshot', () => {
    const config = parseConfig(
      withSwarm('  actions:\n    a: { run: x }\n  stages:\n    after_delivery: [a]\n'),
    );
    const read = withConfigDefaults(structuredClone(config));
    expect(read.actions).toEqual(config.actions);
    expect(read.stages).toEqual({ after_delivery: ['a'] });
  });
});

describe('editing actions', () => {
  function prepared(): ConfigPaths {
    const paths = temporaryPaths();
    writeLevel(paths.project, BASE);
    return paths;
  }

  it('finds the file of an action in the directory of the level', () => {
    const paths = prepared();
    expect(entryFile(paths, 'action', 'commit')).toBe(
      join(paths.project.directory, 'actions', 'commit.yaml'),
    );
    expect(entryFile(paths, 'action', 'commit', 'global')).toBe(
      join(paths.global.directory, 'actions', 'commit.yaml'),
    );
    expect(() => entryFile(paths, 'action', '../x')).toThrow(/id must match/);
  });

  it('writes a new action after checking the whole configuration', () => {
    const paths = prepared();
    const plan = planEdit(paths, {
      kind: 'action',
      id: 'commit',
      value: { run: 'git commit -am x' },
      revision: null,
    });
    expect(plan).toMatchObject({
      ok: true,
      file: join(paths.project.directory, 'actions', 'commit.yaml'),
    });
  });

  it('does not write an action without run and specialist, naming the field', () => {
    const paths = prepared();
    const plan = planEdit(paths, {
      kind: 'action',
      id: 'commit',
      value: { name: 'x' },
      revision: null,
    });
    expect(plan).toMatchObject({ ok: false, reason: 'invalid' });
    if (!plan.ok && plan.reason === 'invalid') {
      expect(plan.errors).toContainEqual({
        file: join(paths.project.directory, 'actions', 'commit.yaml'),
        path: 'swarm.actions.commit',
        message: expect.stringContaining('one of `run` and `specialist`'),
      });
    }
  });

  it('refuses a stale revision', () => {
    const paths = prepared();
    const file = join(paths.project.directory, 'actions', 'commit.yaml');
    write(file, 'run: a\n');
    const plan = planEdit(paths, {
      kind: 'action',
      id: 'commit',
      value: { run: 'b' },
      revision: revisionOf('run: other\n'),
    });
    expect(plan).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('refuses to delete an action that a point names, listing the references', () => {
    const paths = temporaryPaths();
    writeLevel(
      paths.project,
      withSwarm(
        '  actions:\n    commit: { run: a }\n  stages:\n    after_delivery: [commit]\n',
        BASE.replace('      steps:', '      stages: { before_delivery: [commit] }\n      steps:'),
      ),
    );
    const file = join(paths.project.directory, 'actions', 'commit.yaml');
    const plan = planEdit(paths, {
      kind: 'action',
      id: 'commit',
      value: null,
      revision: revisionOf(readFileSync(file, 'utf8')),
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      references: [{ point: 'after_delivery' }, { pipeline: 'feature', point: 'before_delivery' }],
    });
    expect(readFileSync(file, 'utf8')).toBe('run: a\n');
  });

  it('deletes an action that nothing names', () => {
    const paths = temporaryPaths();
    writeLevel(paths.project, withSwarm('  actions:\n    commit: { run: a }\n'));
    const file = join(paths.project.directory, 'actions', 'commit.yaml');
    const plan = planEdit(paths, {
      kind: 'action',
      id: 'commit',
      value: null,
      revision: revisionOf(readFileSync(file, 'utf8')),
    });
    expect(plan).toMatchObject({ ok: true, text: null });
  });

  it('finds the references in a tree', () => {
    const tree = {
      swarm: {
        stages: { after_split: ['a', 'b'] },
        pipelines: { w: { stages: { after_split: ['a'] } }, v: {} },
      },
    };
    expect(actionReferences(tree, 'a')).toEqual([
      { point: 'after_split' },
      { pipeline: 'w', point: 'after_split' },
    ]);
    expect(actionReferences(tree, 'z')).toEqual([]);
  });

  it('shows the actions of both levels in the editor view', () => {
    const paths = temporaryPaths();
    writeLevel(paths.global, BASE);
    writeLevel(paths.project, BASE);
    write(join(paths.global.directory, 'actions', 'commit.yaml'), 'run: shared\n');
    write(join(paths.project.directory, 'actions', 'commit.yaml'), 'run: mine\n');
    write(join(paths.global.directory, 'actions', 'lint.yaml'), 'run: lint\n');
    const view = editorView(paths);
    expect(view.actions.map((action) => [action.id, action.level, action.raw.run])).toEqual([
      ['commit', 'project_over_global', 'mine'],
      ['lint', 'global', 'lint'],
    ]);
    expect(view.actions[1]?.revision).toBeNull();
  });

  it('writes the delivery prompts as settings', () => {
    const paths = prepared();
    const view = editorView(paths);
    expect(view.settings.map((setting) => setting.path)).toEqual(
      expect.arrayContaining(['delivery.message_prompt', 'delivery.resolver_prompt']),
    );
    expect(
      view.settings.find((setting) => setting.path === 'delivery.resolver_prompt'),
    ).toMatchObject({
      value: null,
      kind: 'string',
    });
  });
});
