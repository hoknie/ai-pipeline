import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigLoadError,
  findSpecialist,
  findPipeline,
  groupPipeline,
  withConfigDefaults,
  pipelineName,
  pipelineNameOf,
  type ConfigPaths,
  type FieldError,
  type LevelPaths,
} from '../../../src/feature/swarm-config/types/index.ts';
import {
  configFromFiles,
  configPaths,
  loadConfig,
  loadConfigSources,
  loadRuntimeSettings,
  loadWebSettings,
  parseConfig,
} from '../../../src/feature/swarm-config/services/index.ts';
import { writeLevelDirectory } from '../../fixtures/config.ts';

const repositoryRoot = join(import.meta.dirname, '..', '..', '..');

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-config-'));
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

const BASE = 'swarm:\n  specialists:\n    coder: { name: Кодировщик }\n';

describe('loading files', () => {
  it('replaces the global specialist with the project one', () => {
    const paths = temporaryPaths();
    writeLevel(
      paths.global,
      'swarm:\n  specialists:\n    coder: { name: C, model: a, skills: [x] }\n',
    );
    writeLevel(paths.project, 'swarm:\n  specialists:\n    coder: { name: C, model: b }\n');
    const coder = findSpecialist(loadConfig(paths), 'coder');
    expect(coder?.model).toBe('b');
    expect(coder?.skills).toEqual([]);
  });

  it('marks specialists by the level that defines them', () => {
    const paths = temporaryPaths();
    writeLevel(
      paths.global,
      'swarm:\n  specialists:\n    shared: { name: S }\n    both: { name: B, model: a }\n',
    );
    writeLevel(
      paths.project,
      'swarm:\n  specialists:\n    own: { name: O }\n    both: { name: B, model: b }\n',
    );
    const levels = Object.fromEntries(
      loadConfig(paths).specialists.map((specialist) => [specialist.slug, specialist.level]),
    );
    expect(levels).toEqual({ shared: 'global', both: 'project', own: 'project' });
  });

  it('marks every specialist global when only the global level has files, project when only the project has', () => {
    const globalOnly = temporaryPaths();
    writeLevel(globalOnly.global, BASE);
    expect(loadConfig(globalOnly).specialists.map((item) => item.level)).toEqual(['global']);
    const projectOnly = temporaryPaths();
    writeLevel(projectOnly.project, BASE);
    expect(loadConfig(projectOnly).specialists.map((item) => item.level)).toEqual(['project']);
    expect(
      configFromFiles({ specialists: { coder: 'name: C\n' } }).specialists.map(
        (item) => item.level,
      ),
    ).toEqual(['project']);
  });

  it('names every expected path when no file exists, also with an empty specialists directory', () => {
    const paths = temporaryPaths();
    mkdirSync(join(paths.project.directory, 'specialists'), { recursive: true });
    const message = (() => {
      try {
        loadConfig(paths);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    for (const expected of [paths.global.directory, paths.project.directory]) {
      expect(message).toContain(expected);
    }
  });

  it('accepts the global file alone', () => {
    const paths = temporaryPaths();
    writeLevel(paths.global, BASE);
    expect(loadConfig(paths).specialists).toHaveLength(1);
  });

  it('names the file and the line of a syntax error', () => {
    const paths = temporaryPaths();
    writeLevel(paths.project, 'swarm:\n  max: 1\n');
    write(join(paths.project.directory, 'settings.yaml'), 'max: [\n');
    expect(() => loadConfig(paths)).toThrow(/aip\/settings\.yaml: .*line/);
  });
});

describe('validation', () => {
  it('reports max out of range with its path and range', () => {
    expectError(errorsOf('swarm:\n  max: 0\n'), 'swarm.max', 'from 1 to 32');
  });

  it('defaults max to three', () => {
    expect(parseConfig(BASE).max).toBe(3);
  });

  it('lets a specialist inherit runtime and the other defaults', () => {
    const config = parseConfig(
      'swarm:\n  defaults: { runtime: opencode, permissions: read, timeout: 5m, allow_commands: ["make*"] }\n  specialists:\n    qa: { name: QA }\n    coder: { name: C, runtime: claude, permissions: full }\n',
    );
    expect(findSpecialist(config, 'qa')).toMatchObject({
      runtime: 'opencode',
      permissions: 'read',
      timeoutSeconds: 300,
      allowCommands: ['make*'],
    });
    expect(findSpecialist(config, 'coder')).toMatchObject({
      runtime: 'claude',
      permissions: 'full',
    });
  });

  it('applies built-in defaults without a defaults section', () => {
    expect(findSpecialist(parseConfig(BASE), 'coder')).toMatchObject({
      runtime: 'claude',
      permissions: 'edit',
      timeoutSeconds: 1800,
    });
  });

  it('requires a specialist name', () => {
    expectError(
      errorsOf('swarm:\n  specialists:\n    coder: { model: x }\n'),
      'swarm.specialists.coder.name',
      'required',
    );
  });

  it('reports an invalid slug with the pattern', () => {
    expectError(
      errorsOf('swarm:\n  specialists:\n    Code_R: { name: C }\n'),
      'swarm.specialists.Code_R',
      '^[a-z][a-z0-9-]{0,31}$',
    );
  });

  it('reads queue of a specialist, defaults it to false and keeps it out of defaults', () => {
    const config = parseConfig(
      'swarm:\n  specialists:\n    summary: { name: S, queue: true }\n    coder: { name: C }\n',
    );
    expect(findSpecialist(config, 'summary')?.queue).toBe(true);
    expect(findSpecialist(config, 'coder')?.queue).toBe(false);
    expectError(
      errorsOf('swarm:\n  specialists:\n    summary: { name: S, queue: yes please }\n'),
      'swarm.specialists.summary.queue',
      '',
    );
    expectError(
      errorsOf('swarm:\n  defaults: { queue: true }\n'),
      'swarm.defaults.queue',
      'unknown key',
    );
  });

  it('reports invalid runtimes, permissions and durations', () => {
    const errors = errorsOf(
      'swarm:\n  defaults: { runtime: cursor, permissions: admin, timeout: 30x }\n',
    );
    expectError(errors, 'swarm.defaults.runtime', 'claude, opencode');
    expectError(errors, 'swarm.defaults.permissions', 'read, edit, full');
    expectError(errors, 'swarm.defaults.timeout', 'duration');
  });

  it('treats unknown keys as errors at every level', () => {
    const errors = errorsOf(
      'extra: 1\nswarm:\n  maxx: 2\n  specialists:\n    coder: { name: C, modle: x }\n  pipelines:\n    f:\n      stepz: []\n',
    );
    expectError(errors, 'extra', 'unknown key');
    expectError(errors, 'swarm.maxx', 'unknown key');
    expectError(errors, 'swarm.specialists.coder.modle', 'unknown key');
    expectError(errors, 'swarm.pipelines.f.stepz', 'unknown key');
    expectError(errors, 'swarm.pipelines.f.steps', 'required');
  });

  it('reads the MCP servers of a specialist', () => {
    const config = parseConfig(
      'swarm:\n  specialists:\n    plan:\n      name: P\n      mcp:\n        code-graph:\n          command: /bin/graph\n          args: [--scout]\n          env: { A: b }\n    coder: { name: C }\n',
    );
    expect(findSpecialist(config, 'plan')?.mcp).toEqual({
      'code-graph': { command: '/bin/graph', args: ['--scout'], env: { A: 'b' } },
    });
    expect(findSpecialist(config, 'coder')?.mcp).toBeUndefined();
  });

  it('rejects wrong MCP servers of a specialist', () => {
    const errors = errorsOf(
      'swarm:\n  specialists:\n    a:\n      name: A\n      mcp:\n        aip: { command: x }\n        "b c": { command: x }\n        d: { args: [] }\n        e: { command: bin/x }\n        f: { command: x, url: y }\n',
    );
    expectError(errors, 'swarm.specialists.a.mcp.aip', 'reserved');
    expectError(errors, 'swarm.specialists.a.mcp.b c', 'letters');
    expectError(errors, 'swarm.specialists.a.mcp.d.command', 'required');
    expectError(errors, 'swarm.specialists.a.mcp.e.command', 'absolute path');
    expectError(errors, 'swarm.specialists.a.mcp.f.url', 'unknown key');
  });

  it('allows MCP servers of a specialist on any runtime', () => {
    const config = parseConfig(
      'swarm:\n  specialists:\n    a: { name: A, runtime: opencode, mcp: { g: { command: x } } }\n',
    );
    expect(findSpecialist(config, 'a')?.mcp).toEqual({ g: { command: 'x', args: [], env: {} } });
  });

  it('requires the swarm root', () => {
    expectError(errorsOf('other: 1\n'), 'swarm', 'required');
  });

  it('lists known slugs for a reference to an unknown specialist', () => {
    const errors = errorsOf(
      'swarm:\n  specialists:\n    coder: { name: C }\n    reviewer: { name: R }\n  pipelines:\n    feature:\n      steps:\n        - { id: plan, specialist: coder }\n        - { id: code, specialist: coder }\n        - { id: review, specialist: reviewr }\n',
    );
    expectError(errors, 'swarm.pipelines.feature.steps[2].specialist', 'known: coder, reviewer');
  });

  it('requires goto to point to an earlier step', () => {
    const errors = errorsOf(
      'swarm:\n  specialists:\n    coder: { name: C }\n  pipelines:\n    feature:\n      steps:\n        - { id: code, specialist: coder, on_reject: { goto: qa, max_rounds: 2 } }\n        - { id: qa, specialist: coder }\n',
    );
    expectError(errors, 'swarm.pipelines.feature.steps[0].on_reject.goto', 'earlier step');
  });

  it('rejects goto to the same step and to an unknown step', () => {
    const errors = errorsOf(
      'swarm:\n  specialists:\n    coder: { name: C }\n  pipelines:\n    feature:\n      steps:\n        - { id: code, specialist: coder, on_reject: { goto: code, max_rounds: 1 } }\n        - { id: qa, specialist: coder, on_reject: { goto: nope, max_rounds: 1 } }\n',
    );
    expectError(errors, 'swarm.pipelines.feature.steps[0].on_reject.goto', 'earlier step');
    expectError(errors, 'swarm.pipelines.feature.steps[1].on_reject.goto', 'unknown step');
  });

  it('checks the range and presence of max_rounds', () => {
    const errors = errorsOf(
      'swarm:\n  specialists:\n    coder: { name: C }\n  pipelines:\n    feature:\n      steps:\n        - { id: code, specialist: coder }\n        - { id: review, specialist: coder, on_reject: { goto: code, max_rounds: 11 } }\n        - { id: qa, specialist: coder, on_reject: { goto: code } }\n',
    );
    expectError(errors, 'swarm.pipelines.feature.steps[1].on_reject.max_rounds', 'from 1 to 10');
    expectError(errors, 'swarm.pipelines.feature.steps[2].on_reject.max_rounds', 'required');
  });

  it('rejects duplicate step ids and empty steps', () => {
    const errors = errorsOf(
      'swarm:\n  specialists:\n    coder: { name: C }\n  pipelines:\n    a:\n      steps:\n        - { id: code, specialist: coder }\n        - { id: code, specialist: coder }\n    b:\n      steps: []\n',
    );
    expectError(errors, 'swarm.pipelines.a.steps[1].id', 'duplicate');
    expectError(errors, 'swarm.pipelines.b.steps', 'must not be empty');
  });

  it('reports every error at once', () => {
    const errors = errorsOf(
      'swarm:\n  max: 100\n  specialists:\n    coder: { name: C }\n  pipelines:\n    feature:\n      steps:\n        - { id: code, specialst: coder }\n',
    );
    expectError(errors, 'swarm.max', 'from 1 to 32');
    expectError(errors, 'swarm.pipelines.feature.steps[0].specialst', 'unknown key');
    expectError(errors, 'swarm.pipelines.feature.steps[0].specialist', 'required');
  });
});

describe('yaml features and examples', () => {
  it('supports anchors and merge keys', () => {
    const config = parseConfig(
      'swarm:\n  specialists:\n    coder: &coder { name: Coder, model: m }\n    qa:\n      <<: *coder\n      name: QA\n',
    );
    expect(findSpecialist(config, 'qa')).toMatchObject({ name: 'QA', model: 'm' });
  });

  it('parses a specialists-only file with comments and a multi-line prompt', () => {
    const config = parseConfig(`swarm:
  max: 5 # parallel specialists
  specialists:
    plan: # specialist slug
      name: Планировщик
      model: opus-5-5
      skills:
        - opsx:propose
        - grill-me
      prompt: |
        Используя все навыки, которые нам передали, необходимо сделать следующее: %s
    coder:
      name: Кодировщик
      model: sonnet-5
    qa:
      name: Тестировщик
      model: opus-5-5
      prompt: Проверь все внесенные изменения и выведи QA Check List
`);
    expect(config.max).toBe(5);
    expect(findSpecialist(config, 'plan')).toMatchObject({
      name: 'Планировщик',
      skills: ['opsx:propose', 'grill-me'],
    });
  });

  it('accepts the shipped example', () => {
    const paths = configPaths(
      join(repositoryRoot, 'examples'),
      join(tmpdir(), 'aip-no-xdg'),
      undefined,
    );
    const loaded = loadConfigSources(paths);
    expect(loaded.files[0]).toBe(join(repositoryRoot, 'examples', 'aip', 'settings.yaml'));
    const feature = findPipeline(loaded.config, 'feature');
    expect(feature?.steps).toHaveLength(4);
    expect(feature?.steps[2]?.onReject?.goto).toBe('code');
  });
});

describe('project settings', () => {
  it('defaults workspace_dir, outside_changes and claude.edit_mode', () => {
    expect(parseConfig(BASE)).toMatchObject({
      workspaceDir: '.aip',
      outsideChanges: 'warn',
      claude: { editMode: 'allowlist', settings: 'isolated' },
    });
  });

  it('reads the settings and merges claude field by field', () => {
    const paths = temporaryPaths();
    writeLevel(
      paths.global,
      `${BASE}  claude: { edit_mode: accept_edits }\n  outside_changes: stop\n`,
    );
    writeLevel(
      paths.project,
      `${BASE}  workspace_dir: /tmp/aip-work\n  claude: { settings: inherit }\n`,
    );
    expect(loadConfig(paths)).toMatchObject({
      workspaceDir: '/tmp/aip-work',
      outsideChanges: 'stop',
      claude: { editMode: 'accept_edits', settings: 'inherit' },
    });
    expect(parseConfig(`${BASE}  claude: { edit_mode: auto }\n`).claude.editMode).toBe('auto');
  });

  it('rejects unknown modes with the allowed values', () => {
    const errors = errorsOf(
      `${BASE}  claude: { edit_mode: yolo, settings: user, other: 1 }\n  outside_changes: loud\n`,
    );
    expectError(errors, 'swarm.claude.edit_mode', 'allowlist, accept_edits, auto');
    expectError(errors, 'swarm.claude.settings', 'isolated, inherit');
    expectError(errors, 'swarm.claude.other', 'unknown key');
    expectError(errors, 'swarm.outside_changes', 'warn, stop, off');
  });
});

describe('split', () => {
  const pipeline = (split: string) =>
    `${BASE}  pipelines:\n    feature:\n      split: ${split}\n      steps:\n        - { id: code, specialist: coder }\n`;

  it('reads the splitting specialist and defaults max_groups to five', () => {
    expect(findPipeline(parseConfig(pipeline('{ specialist: coder }')), 'feature')?.split).toEqual({
      specialist: 'coder',
      maxGroups: 5,
      additionalPrompt: null,
      pipeline: null,
    });
    expect(
      findPipeline(parseConfig(pipeline('{ specialist: coder, max_groups: 2 }')), 'feature')?.split
        ?.maxGroups,
    ).toBe(2);
  });

  it('has no split by default', () => {
    expect(
      findPipeline(
        parseConfig(pipeline('{ specialist: coder }').replace(/      split.*\n/, '')),
        'feature',
      )?.split,
    ).toBeNull();
  });

  it('rejects an unknown splitting specialist and max_groups out of range', () => {
    expectError(
      errorsOf(pipeline('{ specialist: splitter }')),
      'swarm.pipelines.feature.split.specialist',
      'unknown specialist',
    );
    expectError(
      errorsOf(pipeline('{ specialist: coder, max_groups: 21 }')),
      'swarm.pipelines.feature.split.max_groups',
      'from 1 to 20',
    );
    expectError(
      errorsOf(pipeline('{ max_groups: 2 }')),
      'swarm.pipelines.feature.split.specialist',
      'required',
    );
  });
});

describe('delivery and MCP settings', () => {
  it('defaults delivery and claude.mcp', () => {
    expect(parseConfig(BASE)).toMatchObject({
      claude: { editMode: 'allowlist', mcp: 'isolated' },
      delivery: {
        mode: 'worktree',
        auto: true,
        keep: false,
        commitMessage: '{title}\n\n{groups}',
        messageSpecialist: null,
        resolver: null,
        resolverRounds: 1,
      },
      workspace: { base: 'working_tree', include: [] },
    });
  });

  it('merges delivery field by field between the global and the project file', () => {
    const paths = temporaryPaths();
    writeLevel(
      paths.global,
      `${BASE}  delivery: { mode: commit, auto: true }\n  claude: { mcp: inherit }\n`,
    );
    writeLevel(
      paths.project,
      `${BASE}  delivery: { keep: true, commit_message: "feat: {title}" }\n`,
    );
    expect(loadConfig(paths)).toMatchObject({
      claude: { mcp: 'inherit' },
      delivery: { mode: 'commit', auto: true, keep: true, commitMessage: 'feat: {title}' },
    });
  });

  it('rejects unknown modes, non-booleans and an unknown message author', () => {
    const errors = errorsOf(
      `${BASE}  claude: { mcp: none }\n  delivery: { mode: push, auto: yes, keep: 1, message_specialist: writer, extra: 1 }\n`,
    );
    expectError(errors, 'swarm.claude.mcp', 'isolated, inherit');
    expectError(errors, 'swarm.delivery.mode', 'worktree, commit, branch');
    expectError(errors, 'swarm.delivery.keep', 'true or false');
    expectError(errors, 'swarm.delivery.message_specialist', 'known: coder');
    expectError(errors, 'swarm.delivery.extra', 'unknown key');
  });

  it('accepts a known message author', () => {
    expect(
      parseConfig(`${BASE}  delivery: { mode: commit, message_specialist: coder }\n`).delivery,
    ).toMatchObject({
      messageSpecialist: 'coder',
    });
  });

  it('accepts a known resolver with rounds and rejects an unknown one', () => {
    expect(
      parseConfig(`${BASE}  delivery: { resolver: coder, resolver_rounds: 3 }\n`).delivery,
    ).toMatchObject({ resolver: 'coder', resolverRounds: 3 });
    const errors = errorsOf(`${BASE}  delivery: { resolver: fixer, resolver_rounds: 0 }\n`);
    expectError(errors, 'swarm.delivery.resolver', 'known: coder');
    expectError(errors, 'swarm.delivery.resolver_rounds', 'from 1 to 10');
  });
});

describe('workspace settings', () => {
  it('reads base and include and merges them field by field', () => {
    const paths = temporaryPaths();
    writeLevel(paths.global, `${BASE}  workspace: { base: head }\n`);
    writeLevel(paths.project, `${BASE}  workspace: { include: [openspec/, CLAUDE.md] }\n`);
    expect(loadConfig(paths).workspace).toEqual({
      base: 'head',
      include: ['openspec/', 'CLAUDE.md'],
    });
  });

  it('rejects paths outside the repository or inside workspace_dir', () => {
    const errors = errorsOf(
      `${BASE}  workspace: { base: tree, include: [../secrets, /etc, .aip/logs, ok/], extra: 1 }\n`,
    );
    expectError(errors, 'swarm.workspace.base', 'working_tree, head');
    expectError(errors, 'swarm.workspace.include[0]', 'inside the repository');
    expectError(errors, 'swarm.workspace.include[1]', 'inside the repository');
    expectError(errors, 'swarm.workspace.include[2]', 'workspace_dir');
    expectError(errors, 'swarm.workspace.extra', 'unknown key');
    expect(errors.some((error) => error.path.includes('include[3]'))).toBe(false);
  });
});

describe('naming settings', () => {
  it('defaults to a quick claude haiku call and merges field by field', () => {
    expect(parseConfig(BASE).naming).toEqual({ enabled: true, runtime: 'claude', model: 'haiku' });
    const paths = temporaryPaths();
    writeLevel(paths.global, `${BASE}  naming: { runtime: opencode, model: anthropic/haiku }\n`);
    writeLevel(paths.project, `${BASE}  naming: { enabled: false }\n`);
    expect(loadConfig(paths).naming).toEqual({
      enabled: false,
      runtime: 'opencode',
      model: 'anthropic/haiku',
    });
  });

  it('rejects wrong values', () => {
    const errors = errorsOf(`${BASE}  naming: { enabled: 1, runtime: gpt, extra: 1 }\n`);
    expectError(errors, 'swarm.naming.enabled', 'true or false');
    expectError(errors, 'swarm.naming.runtime', 'claude, opencode');
    expectError(errors, 'swarm.naming.extra', 'unknown key');
  });
});

describe('specialist max', () => {
  it('reads max and leaves it null when absent', () => {
    const config = parseConfig(
      'swarm:\n  specialists:\n    coder: { name: C, max: 1 }\n    plan: { name: P }\n',
    );
    expect(findSpecialist(config, 'coder')?.max).toBe(1);
    expect(findSpecialist(config, 'plan')?.max).toBeNull();
  });

  it.each(['0', '33', '2.5', '"1"'])('rejects max: %s with the field path', (value) => {
    expectError(
      errorsOf(`swarm:\n  specialists:\n    coder: { name: C, max: ${value} }\n`),
      'swarm.specialists.coder.max',
      '',
    );
  });

  it('does not accept max in defaults', () => {
    expectError(errorsOf(`${BASE}  defaults: { max: 1 }\n`), 'swarm.defaults.max', '');
  });

  it('fills null for specialists of runs stored before the field existed', () => {
    const config = parseConfig(BASE);
    const stored = structuredClone(config);
    for (const specialist of stored.specialists) delete (specialist as { max?: number }).max;
    expect(withConfigDefaults(stored).specialists.map((specialist) => specialist.max)).toEqual([
      null,
    ]);
  });
});

describe('level of a stored specialist', () => {
  it('is project for runs stored before the field existed', () => {
    const stored = structuredClone(parseConfig(BASE));
    for (const specialist of stored.specialists) delete (specialist as { level?: string }).level;
    expect(withConfigDefaults(stored).specialists.map((specialist) => specialist.level)).toEqual([
      'project',
    ]);
    const global = structuredClone(parseConfig(BASE));
    global.specialists[0]!.level = 'global';
    expect(withConfigDefaults(global).specialists[0]?.level).toBe('global');
  });
});

describe('specialist tools', () => {
  it('inherits tools from defaults unless the specialist sets its own', () => {
    const config = parseConfig(
      'swarm:\n  defaults: { tools: [WebFetch] }\n  specialists:\n    coder: { name: C }\n    web: { name: W, tools: [WebSearch, WebFetch] }\n',
    );
    expect(config.defaults.tools).toEqual(['WebFetch']);
    expect(config.specialists.find((specialist) => specialist.slug === 'coder')?.tools).toEqual([
      'WebFetch',
    ]);
    expect(config.specialists.find((specialist) => specialist.slug === 'web')?.tools).toEqual([
      'WebSearch',
      'WebFetch',
    ]);
    expect(parseConfig(BASE).specialists[0]?.tools).toEqual([]);
  });

  it('rejects tools that are not a list of strings', () => {
    expectError(
      errorsOf(`${BASE}  defaults: { tools: WebFetch }\n`),
      'swarm.defaults.tools',
      'list',
    );
  });
});

describe('human review', () => {
  const PIPELINE = (step: string) =>
    `${BASE}    reviewer: { name: R }\n  pipelines:\n    feature:\n      steps:\n        - { id: code, specialist: coder }\n        - { id: review, specialist: reviewer${step} }\n`;

  it('reads human_review, false by default', () => {
    const config = parseConfig(PIPELINE(', human_review: true'));
    expect(config.pipelines[0]!.steps.map((step) => step.humanReview)).toEqual([false, true]);
  });

  it('rejects a value that is not a boolean', () => {
    expectError(
      errorsOf(PIPELINE(', human_review: "yes"')),
      'swarm.pipelines.feature.steps[1].human_review',
      'true or false',
    );
  });

  it('does not accept the key in split', () => {
    expectError(
      errorsOf(
        `${BASE}  pipelines:\n    feature:\n      split: { specialist: coder, human_review: true }\n      steps:\n        - { id: code, specialist: coder }\n`,
      ),
      'swarm.pipelines.feature.split.human_review',
      'unknown key',
    );
  });

  it('fills false in a snapshot stored before the field existed', () => {
    const stored = structuredClone(parseConfig(PIPELINE(', human_review: true')));
    for (const step of stored.pipelines[0]!.steps)
      delete (step as { humanReview?: boolean }).humanReview;
    expect(withConfigDefaults(stored).pipelines[0]!.steps.map((step) => step.humanReview)).toEqual([
      false,
      false,
    ]);
  });
});

describe('additional prompts', () => {
  const PIPELINE = (step: string, split = '') =>
    `${BASE}    reviewer: { name: R }\n  pipelines:\n    feature:\n${split}      steps:\n        - { id: code, specialist: coder }\n        - { id: review, specialist: reviewer${step} }\n`;

  it('reads the additional prompt of a step and of the split, null by default', () => {
    const config = parseConfig(
      PIPELINE(
        ', additional_prompt: "Только тесты"',
        '      split: { specialist: coder, additional_prompt: Не больше двух групп }\n',
      ),
    );
    const feature = config.pipelines[0]!;
    expect(feature.steps.map((step) => step.additionalPrompt)).toEqual([null, 'Только тесты']);
    expect(feature.split?.additionalPrompt).toBe('Не больше двух групп');
    expect(parseConfig(PIPELINE('')).pipelines[0]?.split).toBeNull();
  });

  it('rejects an empty or non-text additional prompt', () => {
    expectError(
      errorsOf(PIPELINE(', additional_prompt: ""')),
      'swarm.pipelines.feature.steps[1].additional_prompt',
      'empty',
    );
    expectError(
      errorsOf(PIPELINE('', '      split: { specialist: coder, additional_prompt: [a, b] }\n')),
      'swarm.pipelines.feature.split.additional_prompt',
      'string',
    );
  });
});

describe('configuration directory', () => {
  const CODER = 'name: Кодировщик\n';
  const FEATURE = 'steps:\n  - { id: code, specialist: coder }\n';

  function files(paths: ConfigPaths): string {
    return paths.project.directory;
  }

  it('reads settings, then specialists and pipelines by name, skipping other and hidden files', () => {
    const paths = temporaryPaths();
    const dir = files(paths);
    write(join(dir, 'settings.yaml'), 'max: 2\n');
    write(join(dir, 'specialists', 'b.yml'), 'name: B\n');
    write(join(dir, 'specialists', 'a.yaml'), CODER);
    write(join(dir, 'specialists', 'README.md'), 'not yaml');
    write(join(dir, 'specialists', '.draft.yaml'), 'max: 9\n');
    write(join(dir, 'specialists', 'old', 'x.yaml'), 'name: X\n');
    write(join(dir, 'pipelines', 'feature.yaml'), 'steps:\n  - { id: code, specialist: a }\n');
    const loaded = loadConfigSources(paths);
    expect(loaded.files).toEqual([
      join(dir, 'settings.yaml'),
      join(dir, 'specialists', 'a.yaml'),
      join(dir, 'specialists', 'b.yml'),
      join(dir, 'pipelines', 'feature.yaml'),
    ]);
    expect(loaded.config.max).toBe(2);
    expect(loaded.config.specialists.map((specialist) => specialist.slug)).toEqual(['a', 'b']);
  });

  it('works without settings.yaml and orders the global level first', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'specialists', 'coder.yaml'), 'name: C\nmodel: a\n');
    write(join(paths.project.directory, 'specialists', 'coder.yaml'), 'name: C\nmodel: b\n');
    write(join(paths.project.directory, 'pipelines', 'feature.yaml'), FEATURE);
    const loaded = loadConfigSources(paths);
    expect(loaded.files).toEqual([
      join(paths.global.directory, 'specialists', 'coder.yaml'),
      join(paths.project.directory, 'specialists', 'coder.yaml'),
      join(paths.project.directory, 'pipelines', 'feature.yaml'),
    ]);
    expect(findSpecialist(loaded.config, 'coder')?.model).toBe('b');
  });

  it('reads a symlink to a file', () => {
    const paths = temporaryPaths();
    const dir = files(paths);
    write(join(dir, 'real', 'coder.yaml'), CODER);
    mkdirSync(join(dir, 'specialists'), { recursive: true });
    symlinkSync(join(dir, 'real', 'coder.yaml'), join(dir, 'specialists', 'coder.yaml'));
    expect(findSpecialist(loadConfig(paths), 'coder')?.name).toBe('Кодировщик');
  });

  it('merges delivery fields of the two levels', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'delivery: { mode: commit }\n');
    write(join(paths.project.directory, 'settings.yaml'), 'delivery: { auto: false }\n');
    write(join(paths.project.directory, 'specialists', 'coder.yaml'), CODER);
    expect(loadConfig(paths).delivery).toMatchObject({ mode: 'commit', auto: false });
  });

  it('refuses x.yaml next to x.yml and names both files', () => {
    const paths = temporaryPaths();
    const dir = files(paths);
    write(join(dir, 'specialists', 'coder.yaml'), CODER);
    write(join(dir, 'specialists', 'coder.yml'), CODER);
    const error = thrown(() => loadConfig(paths));
    expect(error.detail.kind).toBe('invalid');
    expect(error.message).toContain('swarm.specialists.coder');
    expect(error.message).toContain(join(dir, 'specialists', 'coder.yaml'));
    expect(error.message).toContain(join(dir, 'specialists', 'coder.yml'));
  });

  it('names the file of a syntax error', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'specialists', 'coder.yaml'), 'name: [\n');
    expect(() => loadConfig(paths)).toThrow(join('aip', 'specialists', 'coder.yaml'));
  });

  it('gives errors the file they come from', () => {
    const paths = temporaryPaths();
    const dir = files(paths);
    write(join(dir, 'settings.yaml'), 'max: 0\nswarm: {}\n');
    write(join(dir, 'specialists', 'coder.yaml'), 'name: C\nslug: coder\n');
    write(join(dir, 'pipelines', 'feature.yaml'), 'steps:\n  - { id: code, specialist: nobody }\n');
    const errors = (thrown(() => loadConfig(paths)).detail as { errors: FieldError[] }).errors;
    expect(errors).toContainEqual({
      file: join(dir, 'settings.yaml'),
      path: 'swarm.max',
      message: expect.stringContaining('from 1 to 32'),
    });
    expect(errors).toContainEqual({
      file: join(dir, 'settings.yaml'),
      path: 'swarm.swarm',
      message: expect.stringContaining('unknown'),
    });
    expect(errors).toContainEqual({
      file: join(dir, 'specialists', 'coder.yaml'),
      path: 'swarm.specialists.coder.slug',
      message: expect.stringContaining('unknown'),
    });
    expect(errors).toContainEqual({
      file: join(dir, 'pipelines', 'feature.yaml'),
      path: 'swarm.pipelines.feature.steps[0].specialist',
      message: expect.stringContaining('unknown specialist'),
    });
  });

  it('points an error of a replaced global entry at the project file', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'specialists', 'coder.yaml'), 'name: C\n');
    write(join(paths.project.directory, 'specialists', 'coder.yaml'), 'name: C\nmax: 0\n');
    const errors = (thrown(() => loadConfig(paths)).detail as { errors: FieldError[] }).errors;
    expect(errors[0]?.file).toBe(join(paths.project.directory, 'specialists', 'coder.yaml'));
  });

  it('checks the pipeline id as a slug', () => {
    const paths = temporaryPaths();
    const dir = files(paths);
    write(join(dir, 'specialists', 'coder.yaml'), CODER);
    write(join(dir, 'pipelines', 'Feature_1.yaml'), FEATURE);
    const errors = (thrown(() => loadConfig(paths)).detail as { errors: FieldError[] }).errors;
    expect(errors).toContainEqual({
      file: join(dir, 'pipelines', 'Feature_1.yaml'),
      path: 'swarm.pipelines.Feature_1',
      message: expect.stringContaining('^[a-z][a-z0-9-]{0,31}$'),
    });
  });

  it('explains a leftover swarm.yaml and ignores it next to aip/', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, '..', 'swarm.yaml'), 'swarm:\n  max: 2\n');
    const error = thrown(() => loadConfig(paths));
    expect(error.detail).toEqual({
      kind: 'legacy',
      found: join(paths.project.directory, '..', 'swarm.yaml'),
      expected: paths.project.directory,
    });
    write(join(paths.project.directory, 'specialists', 'coder.yaml'), CODER);
    expect(loadConfig(paths).max).toBe(3);
  });

  it('reports a legacy swarm.d of the global level', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'specialists', 'coder.yaml'), CODER);
    write(join(paths.global.directory, 'swarm.d', 'x.yaml'), 'swarm: {}\n');
    expect(thrown(() => loadConfig(paths)).detail).toMatchObject({
      kind: 'legacy',
      found: join(paths.global.directory, 'swarm.d'),
    });
  });

  it('builds a configuration from texts with logical file names in errors', () => {
    const config = configFromFiles({
      settings: 'max: 4\n',
      specialists: { coder: CODER },
      pipelines: { feature: FEATURE },
    });
    expect(config.max).toBe(4);
    expect(findPipeline(config, 'feature')?.steps).toHaveLength(1);
    const error = thrown(() => configFromFiles({ specialists: { coder: 'name: C\nmax: 0\n' } }));
    expect(error.message).toContain('specialists/coder.yaml');
  });
});

function thrown(action: () => unknown): ConfigLoadError {
  try {
    action();
  } catch (error) {
    if (error instanceof ConfigLoadError) return error;
    throw error;
  }
  throw new Error('expected ConfigLoadError');
}

describe('web settings', () => {
  const web = (text: string) => parseConfig(`${BASE}${text}`).web;

  it('default to autostart with a token on 127.0.0.1:7341', () => {
    expect(web('')).toEqual({ autostart: true, auth: 'token', port: 7341, host: '127.0.0.1' });
  });

  it('accept auth none and keep the other fields at their defaults', () => {
    expect(web('  web: { auth: none }\n')).toEqual({
      autostart: true,
      auth: 'none',
      port: 7341,
      host: '127.0.0.1',
    });
  });

  it('reject a host outside loopback, an unknown key and a wrong port', () => {
    expectError(errorsOf(`${BASE}  web: { host: 0.0.0.0 }\n`), 'swarm.web.host', 'must be one of');
    expectError(errorsOf(`${BASE}  web: { token: x }\n`), 'swarm.web.token', 'unknown key');
    expectError(errorsOf(`${BASE}  web: { port: 0 }\n`), 'swarm.web.port', 'integer from 1');
    expectError(errorsOf(`${BASE}  web: { auth: maybe }\n`), 'swarm.web.auth', 'token, none');
    expectError(
      errorsOf(`${BASE}  web: { autostart: 1 }\n`),
      'swarm.web.autostart',
      'true or false',
    );
  });

  it('fill the defaults of a stored snapshot without them', () => {
    const stored = structuredClone(parseConfig(BASE)) as { web?: unknown };
    delete stored.web;
    expect(withConfigDefaults(stored as Parameters<typeof withConfigDefaults>[0]).web).toEqual({
      autostart: true,
      auth: 'token',
      port: 7341,
      host: '127.0.0.1',
    });
  });

  it('are an error in the project settings, naming the project file', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'specialists', 'coder.yaml'), 'name: C\n');
    write(join(paths.project.directory, 'settings.yaml'), 'web: { autostart: false }\n');
    const error = thrown(() => loadConfigSources(paths));
    expect(error.detail).toMatchObject({ kind: 'invalid' });
    const errors = error.detail.kind === 'invalid' ? error.detail.errors : [];
    expect(errors).toContainEqual({
      file: join(paths.project.directory, 'settings.yaml'),
      path: 'swarm.web',
      message: 'web is set only in the global aip/ directory',
    });
  });

  it('are read from the global file alone, whatever else is wrong', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'web: { auth: none }\nmax: 100\n');
    expect(loadWebSettings(paths).auth).toBe('none');
    expect(() => loadConfig(paths)).toThrow(ConfigLoadError);
  });

  it('ignore a broken specialist file in the global directory', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'web: { auth: none }\n');
    write(join(paths.global.directory, 'specialists', 'x.yaml'), 'name: [\n');
    expect(loadWebSettings(paths).auth).toBe('none');
    expect(() => loadConfig(paths)).toThrow(ConfigLoadError);
  });

  it('fail when settings.yaml and settings.yml both exist', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'web: { auth: none }\n');
    write(join(paths.global.directory, 'settings.yml'), 'web: { autostart: false }\n');
    expect(() => loadWebSettings(paths)).toThrow(ConfigLoadError);
  });

  it('are the defaults without a global directory or section', () => {
    const paths = temporaryPaths();
    expect(loadWebSettings(paths)).toEqual({
      autostart: true,
      auth: 'token',
      port: 7341,
      host: '127.0.0.1',
    });
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    expect(loadWebSettings(paths).port).toBe(7341);
  });

  it('fail to load with the global file and the field path when wrong', () => {
    const paths = temporaryPaths();
    const file = join(paths.global.directory, 'settings.yaml');
    write(file, 'web: { port: 70000 }\n');
    const error = thrown(() => loadWebSettings(paths));
    expect(error.detail).toMatchObject({
      kind: 'invalid',
      errors: [{ file, path: 'swarm.web.port' }],
    });
  });
});

describe('runtimes settings', () => {
  const runtimes = (text: string) => parseConfig(`${BASE}${text}`).runtimes;

  it('default to the names of the CLIs without arguments', () => {
    expect(runtimes('')).toEqual({
      claude: { command: 'claude', enabled: null, args: [], env: {} },
      opencode: { command: 'opencode', enabled: null, args: [], env: {} },
      agy: { command: 'agy', enabled: null, args: [], env: {} },
    });
  });

  it('take a path, arguments and variables of one runtime and leave the other', () => {
    const result = runtimes(
      '  runtimes:\n    opencode: { command: npx, args: [-y, opencode-ai], env: { A_B: "1" } }\n    claude: { command: /opt/claude }\n',
    );
    expect(result.opencode).toEqual({
      command: 'npx',
      enabled: null,
      args: ['-y', 'opencode-ai'],
      env: { A_B: '1' },
    });
    expect(result.claude).toEqual({
      command: '/opt/claude',
      enabled: null,
      args: [],
      env: {},
    });
  });

  it('read enabled as a boolean and keep null while it is not set', () => {
    const result = runtimes(
      '  runtimes:\n    opencode: { enabled: true }\n    claude: { enabled: false }\n',
    );
    expect(result.opencode.enabled).toBe(true);
    expect(result.claude.enabled).toBe(false);
    expect(result.agy.enabled).toBeNull();
    expectError(
      errorsOf(`${BASE}  runtimes: { opencode: { enabled: "yes" } }\n`),
      'swarm.runtimes.opencode.enabled',
      'true or false',
    );
  });

  it('reject an unknown runtime, wrong types, a relative path and a bad variable name', () => {
    expectError(
      errorsOf(`${BASE}  runtimes: { codex: {} }\n`),
      'swarm.runtimes.codex',
      'unknown key',
    );
    expectError(
      errorsOf(`${BASE}  runtimes: { opencode: { args: -y } }\n`),
      'swarm.runtimes.opencode.args',
      'list of strings',
    );
    expectError(
      errorsOf(`${BASE}  runtimes: { claude: { command: bin/claude } }\n`),
      'swarm.runtimes.claude.command',
      'absolute path',
    );
    expectError(
      errorsOf(`${BASE}  runtimes: { claude: { env: { A-B: x } } }\n`),
      'swarm.runtimes.claude.env.A-B',
      'variable name',
    );
    expectError(
      errorsOf(`${BASE}  runtimes: { claude: { env: { A: 1 } } }\n`),
      'swarm.runtimes.claude.env.A',
      'must be a string',
    );
    expectError(
      errorsOf(`${BASE}  runtimes: { claude: { shell: x } }\n`),
      'swarm.runtimes.claude.shell',
      'unknown key',
    );
  });

  it('fill the defaults of a stored snapshot without them', () => {
    const stored = structuredClone(parseConfig(BASE)) as { runtimes?: unknown };
    delete stored.runtimes;
    expect(
      withConfigDefaults(stored as Parameters<typeof withConfigDefaults>[0]).runtimes.claude,
    ).toEqual({ command: 'claude', enabled: null, args: [], env: {} });
  });

  it('are an error in the project settings, naming the project file', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'specialists', 'coder.yaml'), 'name: C\n');
    write(join(paths.project.directory, 'settings.yaml'), 'runtimes: { claude: { command: x } }\n');
    const error = thrown(() => loadConfigSources(paths));
    const errors = error.detail.kind === 'invalid' ? error.detail.errors : [];
    expect(errors).toContainEqual({
      file: join(paths.project.directory, 'settings.yaml'),
      path: 'swarm.runtimes',
      message: 'runtimes is set only in the global aip/ directory',
    });
  });

  it('are read from the global file alone, whatever else is wrong', () => {
    const paths = temporaryPaths();
    write(
      join(paths.global.directory, 'settings.yaml'),
      'runtimes: { claude: { args: [--debug] } }\nmax: 100\n',
    );
    expect(loadRuntimeSettings(paths).claude.args).toEqual(['--debug']);
    expect(() => loadConfig(paths)).toThrow(ConfigLoadError);
  });

  it('are the defaults without the file or the section', () => {
    const paths = temporaryPaths();
    expect(loadRuntimeSettings(paths).opencode.command).toBe('opencode');
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    expect(loadRuntimeSettings(paths).claude).toEqual({
      command: 'claude',
      enabled: null,
      args: [],
      env: {},
    });
  });

  it('fail to load with the global file and the field path when wrong', () => {
    const paths = temporaryPaths();
    const file = join(paths.global.directory, 'settings.yaml');
    write(file, 'runtimes: { claude: { args: 1 } }\n');
    const error = thrown(() => loadRuntimeSettings(paths));
    expect(error.detail).toMatchObject({
      kind: 'invalid',
      errors: [{ file, path: 'swarm.runtimes.claude.args' }],
    });
  });
});

describe('split.pipeline', () => {
  const SPEC = `${BASE}    plan: { name: П }\n`;
  const epic = (body: string, extra = '') =>
    `${SPEC}  pipelines:\n    explore:\n      steps:\n        - { id: research, specialist: coder }\n${extra}    epic:\n${body}`;
  const WITH = '      split: { specialist: plan, pipeline: explore }\n';

  it('reads the target and gives the pipeline no steps of its own', () => {
    const config = parseConfig(epic(WITH));
    const found = findPipeline(config, 'epic');
    expect(found?.split?.pipeline).toBe('explore');
    expect(found?.steps).toEqual([]);
    expect(groupPipeline(config, found!).id).toBe('explore');
  });

  it('uses the pipeline itself without the field, also for a snapshot without it', () => {
    const config = parseConfig(pipelineWithSteps());
    const found = findPipeline(config, 'feature')!;
    expect(groupPipeline(config, found)).toBe(found);
    delete (found.split as unknown as Record<string, unknown>).pipeline;
    expect(groupPipeline(config, found)).toBe(found);
  });

  it('throws when the target is gone from the configuration', () => {
    const config = parseConfig(epic(WITH));
    config.pipelines = config.pipelines.filter((item) => item.id !== 'explore');
    expect(() => groupPipeline(config, findPipeline(config, 'epic')!)).toThrow(/explore/);
  });

  it('rejects steps together with split.pipeline', () => {
    expectError(
      errorsOf(epic(`${WITH}      steps:\n        - { id: a, specialist: coder }\n`)),
      'swarm.pipelines.epic.steps',
      'split.pipeline',
    );
  });

  it('requires steps or split.pipeline', () => {
    expectError(
      errorsOf(epic('      split: { specialist: plan }\n')),
      'swarm.pipelines.epic.steps',
      'is required',
    );
  });

  it('rejects an unknown target', () => {
    const errors = errorsOf(epic('      split: { specialist: plan, pipeline: nope }\n'));
    expectError(
      errors,
      'swarm.pipelines.epic.split.pipeline',
      'unknown pipeline `nope`; known: explore',
    );
  });

  it('rejects a link to itself', () => {
    expectError(
      errorsOf(epic('      split: { specialist: plan, pipeline: epic }\n')),
      'swarm.pipelines.epic.split.pipeline',
      'itself',
    );
  });

  it('rejects a chain', () => {
    const extra = '    mid:\n      split: { specialist: plan, pipeline: explore }\n';
    expectError(
      errorsOf(epic('      split: { specialist: plan, pipeline: mid }\n', extra)),
      'swarm.pipelines.epic.split.pipeline',
      'chains',
    );
  });

  it('resolves a target from another level', () => {
    const paths = temporaryPaths();
    writeLevel(
      paths.global,
      `swarm:\n  specialists:\n    coder: { name: C }\n    plan: { name: П }\n`,
    );
    write(
      join(paths.global.directory, 'pipelines', 'explore.yaml'),
      'steps:\n  - { id: research, specialist: coder }\n',
    );
    write(
      join(paths.project.directory, 'pipelines', 'epic.yaml'),
      'split: { specialist: plan, pipeline: explore }\n',
    );
    const config = loadConfig(paths);
    expect(groupPipeline(config, findPipeline(config, 'epic')!).steps[0]?.id).toBe('research');
  });
});

function pipelineWithSteps(): string {
  return `${BASE}  pipelines:\n    feature:\n      split: { specialist: coder }\n      steps:\n        - { id: code, specialist: coder }\n`;
}

describe('name of a pipeline', () => {
  const STEPS = '      steps:\n        - { id: code, specialist: coder }\n';
  const text = (extra: string) => `${BASE}  pipelines:\n    feature:\n${extra}${STEPS}`;

  it('reads the name, trimmed, and falls back to the id without it', () => {
    const named = parseConfig(text('      name: "  Новая функция "\n'));
    expect(findPipeline(named, 'feature')?.name).toBe('Новая функция');
    expect(pipelineName(findPipeline(named, 'feature')!)).toBe('Новая функция');
    expect(pipelineNameOf(named, 'feature')).toBe('Новая функция');
    const plain = parseConfig(text(''));
    expect(findPipeline(plain, 'feature')?.name).toBeNull();
    expect(pipelineNameOf(plain, 'feature')).toBe('feature');
  });

  it('gives the id for an unknown pipeline and for a snapshot without the field', () => {
    const config = parseConfig(text(''));
    expect(pipelineNameOf(config, 'ghost')).toBe('ghost');
    const old = { id: 'old', split: null, steps: [] } as unknown as Parameters<
      typeof pipelineName
    >[0];
    expect(pipelineName(old)).toBe('old');
  });

  it('accepts a name together with split.pipeline', () => {
    const config = parseConfig(
      `${BASE}  pipelines:\n    explore:\n${STEPS}    epic:\n      name: Эпик\n      split: { specialist: coder, pipeline: explore }\n`,
    );
    expect(pipelineNameOf(config, 'epic')).toBe('Эпик');
  });

  it('rejects an empty name and a name that is not a string', () => {
    expectError(errorsOf(text('      name: "  "\n')), 'swarm.pipelines.feature.name', 'empty');
    expectError(errorsOf(text('      name: 5\n')), 'swarm.pipelines.feature.name', 'string');
  });
});

describe('specialist tags', () => {
  it('accepts tags without changing the specialist', () => {
    const plain = parseConfig(BASE);
    const tagged = parseConfig(
      'swarm:\n  specialists:\n    coder: { name: Кодировщик, tags: [backend, review] }\n',
    );
    expect(tagged.specialists).toEqual(plain.specialists);
  });

  it('rejects tags that are not a list of names', () => {
    expectError(
      errorsOf('swarm:\n  specialists:\n    coder: { name: C, tags: backend }\n'),
      'swarm.specialists.coder.tags',
      'must be a list of strings',
    );
    expectError(
      errorsOf(`swarm:\n  specialists:\n    coder: { name: C, tags: [${'a'.repeat(31)}] }\n`),
      'swarm.specialists.coder.tags',
      'at most 30 characters',
    );
    expectError(
      errorsOf('swarm:\n  specialists:\n    coder: { name: C, tags: ["  "] }\n'),
      'swarm.specialists.coder.tags',
      'must not be empty',
    );
    expectError(
      errorsOf('swarm:\n  specialists:\n    coder: { name: C, tags: ["a\\nb"] }\n'),
      'swarm.specialists.coder.tags',
      'line break',
    );
  });
});

describe('pipeline tags', () => {
  const wf = (extra: string) =>
    `swarm:\n  specialists:\n    coder: { name: C }\n  pipelines:\n    feature:\n      steps:\n        - { id: code, specialist: coder }\n${extra}`;

  it('accepts tags without changing the steps', () => {
    const plain = parseConfig(wf(''));
    const tagged = parseConfig(wf('      tags: [backend, release]\n'));
    expect(tagged.pipelines).toEqual(plain.pipelines);
  });

  it('rejects tags that are not a list of names', () => {
    expectError(
      errorsOf(wf('      tags: backend\n')),
      'swarm.pipelines.feature.tags',
      'must be a list of strings',
    );
    expectError(
      errorsOf(wf(`      tags: [${'a'.repeat(31)}]\n`)),
      'swarm.pipelines.feature.tags',
      'at most 30 characters',
    );
  });
});
