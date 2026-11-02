import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const script = join(root, 'scripts', 'install.sh');
const base = mkdtempSync(join(tmpdir(), 'aip-install-'));
let counter = 0;

interface Sandbox {
  bin: string;
  log: string;
  prefix: string;
}

/** A PATH made only of fake tools, each of which writes its arguments to one log. */
function sandbox(tools: string[] = ['node', 'npm', 'git', 'aip', 'sudo']): Sandbox {
  const dir = join(base, `s${(counter += 1)}`);
  const bin = join(dir, 'bin');
  const prefix = join(dir, 'prefix');
  mkdirSync(bin, { recursive: true });
  mkdirSync(prefix, { recursive: true });
  const log = join(dir, 'log');
  const bodies: Record<string, string> = {
    node: 'echo "${FAKE_NODE_VERSION:-24.1.0}"',
    npm: `echo "npm $*" >> "${log}"; [ "$1" = prefix ] && echo "$FAKE_PREFIX"; exit 0`,
    git: 'exit 0',
    aip: `echo "aip $*" >> "${log}"`,
    sudo: `echo "sudo $*" >> "${log}"`,
  };
  for (const tool of tools) {
    writeFileSync(join(bin, tool), `#!/bin/sh\n${bodies[tool]}\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  return { bin, log, prefix };
}

function run(box: Sandbox, env: Record<string, string> = {}) {
  const result = spawnSync(process.env.AIP_TEST_SH ?? '/bin/sh', [script], {
    env: { PATH: box.bin, HOME: base, FAKE_PREFIX: box.prefix, ...env },
    encoding: 'utf8',
  });
  const log = existsSync(box.log) ? readFileSync(box.log, 'utf8') : '';
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, log };
}

describe('scripts/install.sh', () => {
  it('has valid sh syntax', () => {
    expect(spawnSync('/bin/sh', ['-n', script]).status).toBe(0);
  });

  it('refuses Node.js 22 and installs nothing', () => {
    const result = run(sandbox(), { FAKE_NODE_VERSION: '22.4.0' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Node.js 24 or newer');
    expect(result.log).not.toContain('install');
  });

  it('refuses a machine without git', () => {
    const result = run(sandbox(['node', 'npm', 'aip']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('git');
    expect(result.log).not.toContain('install');
  });

  it('refuses a machine without npm', () => {
    const result = run(sandbox(['node', 'git']));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('npm');
  });

  it('stops before installing when the npm prefix is read-only, and never calls sudo', () => {
    const box = sandbox();
    chmodSync(box.prefix, 0o555);
    const result = run(box);
    chmodSync(box.prefix, 0o755);
    if (process.getuid?.() === 0) return; // root can write anywhere
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('npm config set prefix');
    expect(result.log).not.toContain('sudo');
    expect(result.log).not.toContain('install');
  });

  it('installs when the prefix is read-only but lib/node_modules and bin are writable', () => {
    const box = sandbox();
    mkdirSync(join(box.prefix, 'lib', 'node_modules'), { recursive: true });
    mkdirSync(join(box.prefix, 'bin'), { recursive: true });
    chmodSync(box.prefix, 0o555);
    const result = run(box);
    chmodSync(box.prefix, 0o755);
    expect(result.code, result.stderr).toBe(0);
    expect(result.log).toContain('npm install -g');
  });

  it('runs the aip it just installed, not an older one earlier in PATH', () => {
    const box = sandbox();
    mkdirSync(join(box.prefix, 'bin'), { recursive: true });
    const fresh = join(box.prefix, 'bin', 'aip');
    writeFileSync(fresh, `#!/bin/sh\necho "fresh aip $*" >> "${box.log}"\n`);
    chmodSync(fresh, 0o755);
    const result = run(box);
    expect(result.code, result.stderr).toBe(0);
    expect(result.log).toContain('fresh aip setup --yes');
    expect(result.log).not.toMatch(/^aip setup/m);
  });

  it('installs the package and runs aip setup --yes', () => {
    const result = run(sandbox());
    expect(result.code, result.stderr).toBe(0);
    expect(result.log.split('\n').filter(Boolean)).toEqual([
      'npm prefix -g',
      'npm install -g @hoknie/aip@latest',
      'aip setup --yes',
    ]);
    expect(result.stdout).toContain('aip init');
    expect(result.log).not.toContain('sudo');
  });

  it('installs the version from AIP_VERSION', () => {
    const result = run(sandbox(), { AIP_VERSION: '1.2.3' });
    expect(result.log).toContain('npm install -g @hoknie/aip@1.2.3');
  });

  it('skips aip setup with AIP_NO_SETUP=1', () => {
    const result = run(sandbox(), { AIP_NO_SETUP: '1' });
    expect(result.code).toBe(0);
    expect(result.log).toContain('npm install -g');
    expect(result.log).not.toContain('aip setup');
  });

  it('fails when npm install fails', () => {
    const box = sandbox();
    writeFileSync(
      join(box.bin, 'npm'),
      `#!/bin/sh\n[ "$1" = prefix ] && { echo "$FAKE_PREFIX"; exit 0; }\nexit 1\n`,
    );
    const result = run(box);
    expect(result.code).toBe(1);
    expect(result.log).not.toContain('aip setup');
  });

  it('defaults to the package name of package.json', () => {
    const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
    expect(readFileSync(script, 'utf8')).toContain(`AIP_PACKAGE:-${name}`);
  });
});
