import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  codeRoot,
  currentBuild,
  fingerprintTree,
  packageRoot,
  packageVersion,
} from '../../src/platform/build/index.ts';

const repository = join(import.meta.dirname, '..', '..');
const copies: string[] = [];

afterEach(() => {
  for (const copy of copies.splice(0)) rmSync(copy, { recursive: true, force: true });
});

describe('current build', () => {
  it('fingerprints the whole code tree', () => {
    const build = currentBuild();
    expect(build.fingerprint).toBe(fingerprintTree(join(repository, 'src')).fingerprint);
    expect(build.version).toBe(packageVersion());
  });

  it('notices a change of a file outside the build folder', () => {
    const copy = mkdtempSync(join(tmpdir(), 'aip-build-'));
    copies.push(copy);
    cpSync(join(repository, 'src'), copy, { recursive: true });
    expect(fingerprintTree(copy).fingerprint).toBe(currentBuild().fingerprint);
    writeFileSync(join(copy, 'daemon', 'daemon.ts'), '// changed\n', { flag: 'a' });
    expect(fingerprintTree(copy).fingerprint).not.toBe(currentBuild().fingerprint);
  });
});

describe('locations', () => {
  it('finds the package root with its manifest and templates', () => {
    expect(packageRoot()).toBe(repository);
    expect(existsSync(join(packageRoot(), 'package.json'))).toBe(true);
    expect(existsSync(join(packageRoot(), 'templates', 'aip'))).toBe(true);
  });

  it('finds the code root', () => {
    expect(codeRoot()).toBe(join(repository, 'src'));
  });
});
