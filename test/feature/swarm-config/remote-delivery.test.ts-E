import { describe, expect, it } from 'vitest';

import { ConfigLoadError, type FieldError } from '../../../src/feature/swarm-config/types/index.ts';
import {
  ConfigService,
  parseConfig,
  requireDeliveryMode,
} from '../../../src/feature/swarm-config/services/index.ts';
import { configWarnings } from '../../../src/presentation/cli/local/config-check.ts';

const SERVER = '  server: { enabled: true, public_url: "https://aip.example.com" }\n';

const BASE = `swarm:
  specialists:
    coder: { name: Coder, runtime: claude, model: sonnet }
`;

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

describe('delivery settings of a remote repository', () => {
  it('push is off and remote is origin by default in the local mode', () => {
    const config = parseConfig(BASE);
    expect(config.delivery).toMatchObject({ mode: 'worktree', push: false, remote: 'origin' });
    expect(config.delivery.baseBranch).toBeUndefined();
  });

  it('the server mode delivers a branch and sends it by default', () => {
    expect(parseConfig(`${BASE}${SERVER}`).delivery).toMatchObject({
      mode: 'branch',
      push: true,
      remote: 'origin',
    });
  });

  it('reads push, remote and base_branch', () => {
    const config = parseConfig(
      `${BASE}  delivery: { mode: branch, push: true, remote: upstream, base_branch: develop }\n`,
    );
    expect(config.delivery).toMatchObject({
      mode: 'branch',
      push: true,
      remote: 'upstream',
      baseBranch: 'develop',
    });
  });

  it('refuses a push that is not a boolean', () => {
    expect(errorsOf(`${BASE}  delivery: { push: yes please }\n`)).toContainEqual({
      path: 'swarm.delivery.push',
      message: expect.stringContaining('true or false'),
    });
  });

  it('refuses an empty remote and an empty base branch', () => {
    const errors = errorsOf(`${BASE}  delivery: { remote: "", base_branch: "" }\n`);
    expect(errors.map((error) => error.path)).toEqual([
      'swarm.delivery.remote',
      'swarm.delivery.base_branch',
    ]);
  });

  it.each(['worktree', 'commit'])('refuses delivery.mode %s in the server mode', (mode) => {
    const errors = errorsOf(`${BASE}${SERVER}  delivery: { mode: ${mode} }\n`);
    expect(errors).toEqual([
      { path: 'swarm.delivery.mode', message: expect.stringContaining('`branch`') },
    ]);
    expect(errors[0]?.message).toContain('aip run apply');
  });

  it('accepts delivery.mode branch in the server mode', () => {
    expect(
      parseConfig(`${BASE}${SERVER}  delivery: { mode: branch, push: false }\n`).delivery,
    ).toMatchObject({ mode: 'branch', push: false });
  });

  it('warns that workspace.base is ignored in the server mode only', () => {
    const config = parseConfig(`${BASE}  workspace: { base: head }\n`);
    expect(configWarnings(config, true).join('\n')).toContain('workspace.base is ignored');
    expect(configWarnings(config, false).join('\n')).not.toContain('workspace.base');
  });
});

describe('the delivery mode of a task or a request in the server mode', () => {
  function service(enabled: boolean): ConfigService {
    const service = new ConfigService({ environment: {} });
    service.serverSettings = () => ({ enabled }) as never;
    return service;
  }

  it('refuses worktree and commit and lets branch and nothing through', () => {
    const server = service(true);
    expect(() => requireDeliveryMode(server, 'worktree')).toThrow(/aip run apply/);
    expect(() => requireDeliveryMode(server, 'commit')).toThrow(/branch/);
    expect(() => requireDeliveryMode(server, 'branch')).not.toThrow();
    expect(() => requireDeliveryMode(server, undefined)).not.toThrow();
    expect(() => requireDeliveryMode(server, null)).not.toThrow();
  });

  it('refuses nothing in the local mode', () => {
    expect(() => requireDeliveryMode(service(false), 'worktree')).not.toThrow();
  });
});
