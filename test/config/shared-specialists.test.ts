import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configPaths, sharedSpecialistUsage, type ConfigPaths } from '../../src/config/index.ts';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aip-shared-'));
  const xdg = join(root, 'xdg');
  const paths = (name: string) => configPaths(join(root, name), xdg, undefined);
  return { root, xdg, app: paths('app'), lib: paths('lib'), anywhere: paths('any') };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const shared = (paths: ConfigPaths, ...rest: string[]) => join(paths.global.directory, ...rest);
const project = (paths: ConfigPaths, ...rest: string[]) => join(paths.project.directory, ...rest);

const projects = (...entries: [string, ConfigPaths][]) =>
  entries.map(([repository, paths]) => ({ repository, paths }));

describe('sharedSpecialistUsage', () => {
  it('lists shared specialists in slug order with the file and name', () => {
    const { app } = setup();
    write(shared(app, 'specialists', 'writer.yaml'), 'name: Writer\n');
    write(shared(app, 'specialists', 'qa.yaml'), 'model: x\n');
    const usage = sharedSpecialistUsage(app, []);
    expect(usage.directory).toBe(shared(app, 'specialists'));
    expect(usage.specialists.map((entry) => [entry.slug, entry.name])).toEqual([
      ['qa', null],
      ['writer', 'Writer'],
    ]);
    expect(usage.specialists[0]?.file).toBe(shared(app, 'specialists', 'qa.yaml'));
    expect(usage.specialists[0]?.revision).toEqual(expect.any(String));
  });

  it('finds a reference from a project workflow, only in that repository', () => {
    const { app, lib } = setup();
    write(shared(app, 'specialists', 'qa.yaml'), 'name: QA\n');
    write(project(lib, 'workflows', 'feature.yaml'), 'steps:\n  - id: test\n    specialist: qa\n');
    const [qa] = sharedSpecialistUsage(
      app,
      projects(['/work/app', app], ['/work/lib', lib]),
    ).specialists;
    expect(qa?.global).toEqual([]);
    expect(qa?.projects).toEqual([
      { repository: '/work/lib', references: [{ workflow: 'feature', step: 'test' }] },
    ]);
  });

  it('counts a shared workflow in every repository and in the shared level', () => {
    const { app, lib } = setup();
    write(shared(app, 'specialists', 'coder.yaml'), 'name: Coder\n');
    write(shared(app, 'workflows', 'quick.yaml'), 'steps:\n  - id: code\n    specialist: coder\n');
    const [coder] = sharedSpecialistUsage(
      app,
      projects(['/work/app', app], ['/work/lib', lib]),
    ).specialists;
    expect(coder?.global).toEqual([{ workflow: 'quick', step: 'code' }]);
    expect(coder?.projects.map((entry) => entry.repository)).toEqual(['/work/app', '/work/lib']);
  });

  it('does not count a repository that overrides the specialist', () => {
    const { app, lib } = setup();
    write(shared(app, 'specialists', 'coder.yaml'), 'name: Coder\n');
    write(project(app, 'specialists', 'coder.yaml'), 'name: Own\n');
    for (const paths of [app, lib]) {
      write(project(paths, 'workflows', 'f.yaml'), 'steps:\n  - id: s\n    specialist: coder\n');
    }
    const [coder] = sharedSpecialistUsage(
      app,
      projects(['/work/app', app], ['/work/lib', lib]),
    ).specialists;
    expect(coder?.projects.map((entry) => entry.repository)).toEqual(['/work/lib']);
  });

  it('finds the delivery resolver of a project settings file', () => {
    const { app, lib } = setup();
    write(shared(app, 'specialists', 'fixer.yaml'), 'name: Fixer\n');
    write(project(lib, 'settings.yaml'), 'delivery:\n  resolver: fixer\n');
    const [fixer] = sharedSpecialistUsage(app, projects(['/work/lib', lib])).specialists;
    expect(fixer?.projects).toEqual([
      { repository: '/work/lib', references: [{ field: 'delivery.resolver' }] },
    ]);
  });

  it('reports a broken shared file with an error and keeps the others', () => {
    const { app, lib } = setup();
    write(shared(app, 'specialists', 'bad.yaml'), 'name: [unclosed\n');
    write(shared(app, 'specialists', 'good.yaml'), 'name: Good\n');
    write(project(lib, 'workflows', 'f.yaml'), 'steps:\n  - id: s\n    specialist: bad\n');
    const { specialists } = sharedSpecialistUsage(app, projects(['/work/lib', lib]));
    const bad = specialists.find((entry) => entry.slug === 'bad');
    expect(bad?.error).toEqual(expect.any(String));
    expect(bad?.projects).toEqual([]);
    expect(bad?.revision).toBeNull();
    expect(specialists.find((entry) => entry.slug === 'good')?.error).toBeUndefined();
  });

  it('treats a repository without aip/ as one without project files', () => {
    const { app, lib } = setup();
    write(shared(app, 'specialists', 'qa.yaml'), 'name: QA\n');
    expect(
      sharedSpecialistUsage(app, projects(['/work/lib', lib])).specialists[0]?.projects,
    ).toEqual([]);
  });

  it('still gives references when the configuration fails validation', () => {
    const { app, lib } = setup();
    write(shared(app, 'specialists', 'qa.yaml'), 'name: QA\n');
    write(project(lib, 'settings.yaml'), 'max: 0\n');
    write(project(lib, 'workflows', 'feature.yaml'), 'steps:\n  - id: test\n    specialist: qa\n');
    const [qa] = sharedSpecialistUsage(app, projects(['/work/lib', lib])).specialists;
    expect(qa?.projects).toEqual([
      { repository: '/work/lib', references: [{ workflow: 'feature', step: 'test' }] },
    ]);
  });

  it('can be limited to one slug', () => {
    const { app } = setup();
    write(shared(app, 'specialists', 'qa.yaml'), 'name: QA\n');
    write(shared(app, 'specialists', 'writer.yaml'), 'name: Writer\n');
    expect(sharedSpecialistUsage(app, [], 'qa').specialists.map((entry) => entry.slug)).toEqual([
      'qa',
    ]);
  });
});
