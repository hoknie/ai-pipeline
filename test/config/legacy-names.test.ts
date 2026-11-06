import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigLoadError,
  commitEdit,
  configPaths,
  entryFile,
  loadConfig,
  loadConfigSources,
  planEdit,
  revisionOf,
  type ConfigPaths,
  type EditPlan,
} from '../../src/config/index.ts';

function setup(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-legacy-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function accepted(plan: EditPlan) {
  if (!plan.ok) throw new Error(`expected an accepted plan: ${JSON.stringify(plan)}`);
  return plan;
}

const STEPS = 'steps:\n  - { id: code, specialist: coder }\n';

function project(paths: ConfigPaths, directory: string, id = 'feature', text = STEPS): string {
  write(join(paths.project.directory, 'specialists', 'coder.yaml'), 'name: Coder\n');
  const file = join(paths.project.directory, directory, `${id}.yaml`);
  write(file, text);
  return file;
}

function loadError(paths: ConfigPaths): string {
  try {
    loadConfig(paths);
  } catch (error) {
    if (error instanceof ConfigLoadError) return error.message;
    throw error;
  }
  throw new Error('expected an error');
}

describe('the old pipelines directory', () => {
  it('reads files of the old directory next to the new one', () => {
    const paths = setup();
    project(paths, 'workflows', 'old');
    project(paths, 'pipelines', 'new');
    expect(
      loadConfig(paths)
        .pipelines.map((pipeline) => pipeline.id)
        .sort(),
    ).toEqual(['new', 'old']);
  });

  it('lets the old project directory override the new global one', () => {
    const paths = setup();
    write(join(paths.global.directory, 'pipelines', 'feature.yaml'), STEPS + 'name: Shared\n');
    project(paths, 'workflows', 'feature', STEPS + 'name: Local\n');
    const found = loadConfig(paths).pipelines.find((pipeline) => pipeline.id === 'feature');
    expect(found?.name).toBe('Local');
  });

  it('uses a shared pipeline of the old global directory', () => {
    const paths = setup();
    write(join(paths.global.directory, 'workflows', 'shared.yaml'), STEPS);
    write(join(paths.global.directory, 'specialists', 'coder.yaml'), 'name: Coder\n');
    expect(loadConfig(paths).pipelines.map((pipeline) => pipeline.id)).toContain('shared');
  });

  it('refuses an id defined in both directories', () => {
    const paths = setup();
    project(paths, 'workflows');
    project(paths, 'pipelines');
    const message = loadError(paths);
    expect(message).toContain('swarm.pipelines.feature');
    expect(message).toContain('defined by two files');
  });

  it('refuses a pipelines key in settings.yaml, also under the old name', () => {
    for (const key of ['pipelines', 'workflows']) {
      const paths = setup();
      project(paths, 'pipelines');
      write(join(paths.project.directory, 'settings.yaml'), `${key}: {}\n`);
      expect(loadError(paths)).toContain(`swarm.${key}`);
    }
  });

  it('lists the files with old names for the hint and nothing for the new layout', () => {
    const paths = setup();
    const old = project(paths, 'workflows', 'old');
    const split = project(
      paths,
      'pipelines',
      'splitter',
      'split: { specialist: coder, workflow: old }\n',
    );
    expect(loadConfigSources(paths).legacy).toEqual([old, split].sort());
    const clean = setup();
    project(clean, 'pipelines');
    expect(loadConfigSources(clean).legacy).toEqual([]);
  });
});

describe('the old split key', () => {
  const splitter = (key: string) => `split: { specialist: coder, ${key}: feature }\n`;

  it('reads split.workflow as split.pipeline', () => {
    const paths = setup();
    project(paths, 'pipelines');
    project(paths, 'pipelines', 'splitter', splitter('workflow'));
    const config = loadConfig(paths);
    const found = config.pipelines.find((pipeline) => pipeline.id === 'splitter');
    expect(found?.split?.pipeline).toBe('feature');
  });

  it('names the new path for an unknown target of the old key', () => {
    const paths = setup();
    project(paths, 'pipelines', 'splitter', 'split: { specialist: coder, workflow: ghost }\n');
    expect(loadError(paths)).toContain('swarm.pipelines.splitter.split.pipeline');
  });

  it('refuses both keys, also with equal values', () => {
    const paths = setup();
    project(paths, 'pipelines');
    project(
      paths,
      'pipelines',
      'splitter',
      'split: { specialist: coder, pipeline: feature, workflow: feature }\n',
    );
    expect(loadError(paths)).toContain('swarm.pipelines.splitter.split');
  });
});

describe('editing in the old directory', () => {
  it('writes to the existing file of the old directory and creates new files in pipelines/', () => {
    const paths = setup();
    const old = project(paths, 'workflows');
    expect(entryFile(paths, 'pipeline', 'feature')).toBe(old);
    expect(entryFile(paths, 'pipeline', 'fresh')).toBe(
      join(paths.project.directory, 'pipelines', 'fresh.yaml'),
    );
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'pipeline',
          id: 'feature',
          value: { steps: [{ id: 'code', specialist: 'coder' }], name: 'Renamed' },
          revision: revisionOf(readFileSync(old, 'utf8')),
        }),
      ),
    );
    expect(readFileSync(old, 'utf8')).toContain('Renamed');
    expect(existsSync(join(paths.project.directory, 'pipelines', 'feature.yaml'))).toBe(false);
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'pipeline',
          id: 'fresh',
          value: { steps: [{ id: 'code', specialist: 'coder' }] },
          revision: null,
        }),
      ),
    );
    expect(existsSync(join(paths.project.directory, 'pipelines', 'fresh.yaml'))).toBe(true);
    expect(existsSync(old)).toBe(true);
  });

  it('deletes the file of the old directory', () => {
    const paths = setup();
    const old = project(paths, 'workflows');
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'pipeline',
          id: 'feature',
          value: null,
          revision: revisionOf(readFileSync(old, 'utf8')),
        }),
      ),
    );
    expect(existsSync(old)).toBe(false);
  });

  it('writes split.pipeline and drops split.workflow', () => {
    const paths = setup();
    project(paths, 'pipelines');
    const file = project(
      paths,
      'workflows',
      'splitter',
      'split: { specialist: coder, workflow: feature }\n',
    );
    commitEdit(
      accepted(
        planEdit(paths, {
          kind: 'pipeline',
          id: 'splitter',
          value: { split: { specialist: 'coder', max_groups: 3, pipeline: 'feature' } },
          revision: revisionOf(readFileSync(file, 'utf8')),
        }),
      ),
    );
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('pipeline: feature');
    expect(text).not.toContain('workflow');
  });
});
