import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';
import { sharedPipelineUsage } from '../../../src/feature/swarm-edit/services/index.ts';
import { type ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aip-shared-wf-'));
  const xdg = join(root, 'xdg');
  const paths = (name: string) => configPaths(join(root, name), xdg, undefined);
  return { app: paths('app'), lib: paths('lib') };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const shared = (paths: ConfigPaths, ...rest: string[]) => join(paths.global.directory, ...rest);
const project = (paths: ConfigPaths, ...rest: string[]) => join(paths.project.directory, ...rest);
const projects = (...entries: [string, ConfigPaths][]) =>
  entries.map(([repository, paths]) => ({ repository, paths }));

const STEPS = 'steps:\n  - id: s\n    specialist: coder\n';

describe('sharedPipelineUsage', () => {
  it('lists shared pipelines in id order with name, tags and file', () => {
    const { app } = setup();
    write(shared(app, 'pipelines', 'quick.yaml'), `name: Quick\ntags: [fast]\n${STEPS}`);
    write(shared(app, 'pipelines', 'explore.yaml'), STEPS);
    const usage = sharedPipelineUsage(app, []);
    expect(usage.directory).toBe(shared(app, 'pipelines'));
    expect(usage.pipelines.map((w) => [w.id, w.name, w.tags])).toEqual([
      ['explore', null, []],
      ['quick', 'Quick', ['fast']],
    ]);
    expect(usage.pipelines[1]?.file).toBe(shared(app, 'pipelines', 'quick.yaml'));
    expect(usage.pipelines[1]?.revision).toEqual(expect.any(String));
  });

  it('finds a split.pipeline reference from a project epic', () => {
    const { app, lib } = setup();
    write(shared(app, 'pipelines', 'explore.yaml'), STEPS);
    write(
      project(lib, 'pipelines', 'epic.yaml'),
      'split:\n  specialist: coder\n  pipeline: explore\n',
    );
    const [explore] = sharedPipelineUsage(
      app,
      projects(['/work/app', app], ['/work/lib', lib]),
    ).pipelines;
    expect(explore?.global).toEqual([]);
    expect(explore?.projects).toEqual([
      { repository: '/work/lib', references: [{ pipeline: 'epic', split: true }] },
    ]);
  });

  it('does not count a repository that overrides the pipeline', () => {
    const { app, lib } = setup();
    write(shared(app, 'pipelines', 'explore.yaml'), STEPS);
    write(project(lib, 'pipelines', 'explore.yaml'), STEPS);
    write(
      project(lib, 'pipelines', 'epic.yaml'),
      'split:\n  specialist: coder\n  pipeline: explore\n',
    );
    const [explore] = sharedPipelineUsage(app, projects(['/work/lib', lib])).pipelines;
    expect(explore?.projects).toEqual([]);
  });

  it('counts a reference from a shared pipeline in the shared level and every repository', () => {
    const { app, lib } = setup();
    write(shared(app, 'pipelines', 'explore.yaml'), STEPS);
    write(
      shared(app, 'pipelines', 'epic.yaml'),
      'split:\n  specialist: coder\n  pipeline: explore\n',
    );
    const explore = sharedPipelineUsage(
      app,
      projects(['/work/app', app], ['/work/lib', lib]),
    ).pipelines.find((w) => w.id === 'explore');
    expect(explore?.global).toEqual([{ pipeline: 'epic', split: true }]);
    expect(explore?.projects.map((p) => p.repository)).toEqual(['/work/app', '/work/lib']);
  });

  it('reports a broken file with an error and keeps the others', () => {
    const { app } = setup();
    write(shared(app, 'pipelines', 'bad.yaml'), 'name: [unclosed\n');
    write(shared(app, 'pipelines', 'good.yaml'), STEPS);
    const { pipelines } = sharedPipelineUsage(app, []);
    const bad = pipelines.find((w) => w.id === 'bad');
    expect(bad?.error).toEqual(expect.any(String));
    expect(bad?.revision).toBeNull();
    expect(pipelines.find((w) => w.id === 'good')?.error).toBeUndefined();
  });

  it('still gives references when the configuration fails validation', () => {
    const { app, lib } = setup();
    write(shared(app, 'pipelines', 'explore.yaml'), STEPS);
    write(project(lib, 'settings.yaml'), 'max: 0\n');
    write(
      project(lib, 'pipelines', 'epic.yaml'),
      'split:\n  specialist: coder\n  pipeline: explore\n',
    );
    const [explore] = sharedPipelineUsage(app, projects(['/work/lib', lib])).pipelines;
    expect(explore?.projects).toHaveLength(1);
  });

  it('can be limited to one id', () => {
    const { app } = setup();
    write(shared(app, 'pipelines', 'a.yaml'), STEPS);
    write(shared(app, 'pipelines', 'b.yaml'), STEPS);
    expect(sharedPipelineUsage(app, [], 'b').pipelines.map((w) => w.id)).toEqual(['b']);
  });
});
