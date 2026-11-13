import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runtimeProblem } from '../../../src/feature/runs/services/effects/runtime-check.ts';

const directory = mkdtempSync(join(tmpdir(), 'aip-runtime-check-'));
const command = join(directory, 'fake-claude');
writeFileSync(command, '#!/bin/sh\n');
chmodSync(command, 0o755);

function dependencies(settings: unknown, enabled: boolean, executable: string) {
  return {
    config: { runtimeSettings: () => settings },
    agents: { isEnabled: () => enabled, runtimeFor: () => ({ executable }) },
    environment: { PATH: directory },
  } as never;
}

describe('runtimeProblem', () => {
  it('is null for an enabled runtime with a command', () => {
    expect(runtimeProblem(dependencies({}, true, command), '/repo', 'claude')).toBeNull();
  });

  it('reports a runtime switched off', () => {
    expect(runtimeProblem(dependencies({}, false, command), '/repo', 'claude')).toEqual({
      kind: 'runtime_disabled',
      runtime: 'claude',
    });
  });

  it('reports a command that is not found', () => {
    expect(
      runtimeProblem(dependencies({}, true, '/nonexistent/claude'), '/repo', 'opencode'),
    ).toEqual({ kind: 'runtime_not_found', runtime: 'opencode' });
  });

  it('reports unreadable settings as spawn', () => {
    expect(runtimeProblem(dependencies('bad runtimes', true, command), '/repo', 'claude')).toEqual({
      kind: 'spawn',
      message: 'bad runtimes',
    });
  });
});
