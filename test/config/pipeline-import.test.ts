import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { commitEdits, configPaths, planImport, type ConfigPaths } from '../../src/config/index.ts';

function setup(): { app: ConfigPaths; lib: ConfigPaths } {
  const root = mkdtempSync(join(tmpdir(), 'aip-wf-import-'));
  const xdg = join(root, 'xdg');
  return {
    app: configPaths(join(root, 'app'), xdg, undefined),
    lib: configPaths(join(root, 'lib'), xdg, undefined),
  };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const wf = (paths: ConfigPaths, id: string) =>
  join(paths.project.directory, 'pipelines', `${id}.yaml`);
const spec = (paths: ConfigPaths, id: string) =>
  join(paths.project.directory, 'specialists', `${id}.yaml`);

describe('importing pipelines', () => {
  it('copies two pipelines byte for byte with their tags', () => {
    const { app, lib } = setup();
    write(spec(app, 'coder'), 'name: Coder\n');
    const quick = '# q\nname: Quick\ntags: [fast]\nsteps:\n  - id: code\n    specialist: coder\n';
    write(wf(lib, 'quick'), quick);
    write(wf(lib, 'slow'), 'steps:\n  - id: code\n    specialist: coder\n');
    const plan = planImport(app, lib, ['quick', 'slow'], 'pipeline');
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    commitEdits(plan.edits);
    expect(readFileSync(wf(app, 'quick'), 'utf8')).toBe(quick);
    expect(existsSync(wf(app, 'slow'))).toBe(true);
  });

  it('reports a taken id as a conflict and writes nothing', () => {
    const { app, lib } = setup();
    write(spec(app, 'coder'), 'name: Coder\n');
    const text = 'steps:\n  - id: code\n    specialist: coder\n';
    write(wf(lib, 'a'), text);
    write(wf(lib, 'b'), text);
    write(wf(app, 'a'), text);
    expect(planImport(app, lib, ['a', 'b'], 'pipeline')).toMatchObject({
      ok: false,
      reason: 'conflict',
      slugs: ['a'],
    });
    expect(existsSync(wf(app, 'b'))).toBe(false);
  });

  it('refuses an id the source does not have', () => {
    const { app, lib } = setup();
    const plan = planImport(app, lib, ['ghost'], 'pipeline');
    expect(plan).toMatchObject({ ok: false, reason: 'invalid' });
    expect(JSON.stringify(plan)).toContain('pipeline `ghost` is not defined in');
  });

  it('refuses a pipeline with a specialist the target does not have', () => {
    const { app, lib } = setup();
    write(wf(lib, 'quick'), 'steps:\n  - id: code\n    specialist: ghost\n');
    const plan = planImport(app, lib, ['quick'], 'pipeline');
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [expect.objectContaining({ path: 'swarm.pipelines.quick.steps[0].specialist' })],
    });
    expect(existsSync(wf(app, 'quick'))).toBe(false);
  });

  it('imports a split pipeline from the old directory with the old key', () => {
    const { app, lib } = setup();
    write(spec(app, 'coder'), 'name: Coder\n');
    write(wf(app, 'feature'), 'steps:\n  - id: code\n    specialist: coder\n');
    const old = join(lib.project.directory, 'workflows', 'splitter.yaml');
    const text = 'split: { specialist: coder, workflow: feature }\n';
    write(old, text);
    const plan = planImport(app, lib, ['splitter'], 'pipeline');
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    commitEdits(plan.edits);
    expect(readFileSync(wf(app, 'splitter'), 'utf8')).toBe(text);
  });

  it('refuses an old split key whose target the project does not have', () => {
    const { app, lib } = setup();
    write(spec(app, 'coder'), 'name: Coder\n');
    write(
      join(lib.project.directory, 'workflows', 'splitter.yaml'),
      'split: { specialist: coder, workflow: ghost }\n',
    );
    const plan = planImport(app, lib, ['splitter'], 'pipeline');
    expect(plan).toMatchObject({ ok: false, reason: 'invalid' });
    expect(existsSync(wf(app, 'splitter'))).toBe(false);
  });

  it('refuses an old split key together with steps', () => {
    const { app, lib } = setup();
    write(spec(app, 'coder'), 'name: Coder\n');
    write(
      join(lib.project.directory, 'workflows', 'splitter.yaml'),
      'steps:\n  - { id: code, specialist: coder }\nsplit: { specialist: coder, workflow: splitter }\n',
    );
    const plan = planImport(app, lib, ['splitter'], 'pipeline');
    expect(plan).toMatchObject({ ok: false, reason: 'invalid' });
    expect(existsSync(wf(app, 'splitter'))).toBe(false);
  });
});
