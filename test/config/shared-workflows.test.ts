import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configPaths, sharedWorkflowUsage, type ConfigPaths } from '../../src/config/index.ts';

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

describe('sharedWorkflowUsage', () => {
  it('lists shared workflows in id order with name, tags and file', () => {
    const { app } = setup();
    write(shared(app, 'workflows', 'quick.yaml'), `name: Quick\ntags: [fast]\n${STEPS}`);
    write(shared(app, 'workflows', 'explore.yaml'), STEPS);
    const usage = sharedWorkflowUsage(app, []);
    expect(usage.directory).toBe(shared(app, 'workflows'));
    expect(usage.workflows.map((w) => [w.id, w.name, w.tags])).toEqual([
      ['explore', null, []],
      ['quick', 'Quick', ['fast']],
    ]);
    expect(usage.workflows[1]?.file).toBe(shared(app, 'workflows', 'quick.yaml'));
    expect(usage.workflows[1]?.revision).toEqual(expect.any(String));
  });

  it('finds a split.workflow reference from a project epic', () => {
    const { app, lib } = setup();
    write(shared(app, 'workflows', 'explore.yaml'), STEPS);
    write(
      project(lib, 'workflows', 'epic.yaml'),
      'split:\n  specialist: coder\n  workflow: explore\n',
    );
    const [explore] = sharedWorkflowUsage(
      app,
      projects(['/work/app', app], ['/work/lib', lib]),
    ).workflows;
    expect(explore?.global).toEqual([]);
    expect(explore?.projects).toEqual([
      { repository: '/work/lib', references: [{ workflow: 'epic', split: true }] },
    ]);
  });

  it('does not count a repository that overrides the workflow', () => {
    const { app, lib } = setup();
    write(shared(app, 'workflows', 'explore.yaml'), STEPS);
    write(project(lib, 'workflows', 'explore.yaml'), STEPS);
    write(
      project(lib, 'workflows', 'epic.yaml'),
      'split:\n  specialist: coder\n  workflow: explore\n',
    );
    const [explore] = sharedWorkflowUsage(app, projects(['/work/lib', lib])).workflows;
    expect(explore?.projects).toEqual([]);
  });

  it('counts a reference from a shared workflow in the shared level and every repository', () => {
    const { app, lib } = setup();
    write(shared(app, 'workflows', 'explore.yaml'), STEPS);
    write(
      shared(app, 'workflows', 'epic.yaml'),
      'split:\n  specialist: coder\n  workflow: explore\n',
    );
    const explore = sharedWorkflowUsage(
      app,
      projects(['/work/app', app], ['/work/lib', lib]),
    ).workflows.find((w) => w.id === 'explore');
    expect(explore?.global).toEqual([{ workflow: 'epic', split: true }]);
    expect(explore?.projects.map((p) => p.repository)).toEqual(['/work/app', '/work/lib']);
  });

  it('reports a broken file with an error and keeps the others', () => {
    const { app } = setup();
    write(shared(app, 'workflows', 'bad.yaml'), 'name: [unclosed\n');
    write(shared(app, 'workflows', 'good.yaml'), STEPS);
    const { workflows } = sharedWorkflowUsage(app, []);
    const bad = workflows.find((w) => w.id === 'bad');
    expect(bad?.error).toEqual(expect.any(String));
    expect(bad?.revision).toBeNull();
    expect(workflows.find((w) => w.id === 'good')?.error).toBeUndefined();
  });

  it('still gives references when the configuration fails validation', () => {
    const { app, lib } = setup();
    write(shared(app, 'workflows', 'explore.yaml'), STEPS);
    write(project(lib, 'settings.yaml'), 'max: 0\n');
    write(
      project(lib, 'workflows', 'epic.yaml'),
      'split:\n  specialist: coder\n  workflow: explore\n',
    );
    const [explore] = sharedWorkflowUsage(app, projects(['/work/lib', lib])).workflows;
    expect(explore?.projects).toHaveLength(1);
  });

  it('can be limited to one id', () => {
    const { app } = setup();
    write(shared(app, 'workflows', 'a.yaml'), STEPS);
    write(shared(app, 'workflows', 'b.yaml'), STEPS);
    expect(sharedWorkflowUsage(app, [], 'b').workflows.map((w) => w.id)).toEqual(['b']);
  });
});
