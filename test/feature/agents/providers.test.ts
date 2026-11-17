import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAgyRuntime } from '../../../src/feature/agents/clients/agy/index.ts';
import { createClaudeRuntime } from '../../../src/feature/agents/clients/claude/index.ts';
import { createClineRuntime } from '../../../src/feature/agents/clients/cline/index.ts';
import { createCodexRuntime } from '../../../src/feature/agents/clients/codex/index.ts';
import { createCopilotRuntime } from '../../../src/feature/agents/clients/copilot/index.ts';
import { createKiloRuntime } from '../../../src/feature/agents/clients/kilo/index.ts';
import { createOpencodeRuntime } from '../../../src/feature/agents/clients/opencode/index.ts';
import type { CommandRunner } from '../../../src/feature/agents/ports/index.ts';
import {
  createAgentsServices,
  type AgentsServices,
} from '../../../src/feature/agents/services/index.ts';
import {
  accessReasons,
  emptyRoles,
  modelMatrix,
  providerStatus,
} from '../../../src/feature/agents/types/index.ts';
import { parseConfig } from '../../../src/feature/swarm-config/services/index.ts';
import type { ResolvedConfig } from '../../../src/feature/swarm-config/types/index.ts';

const facts = {
  accessEnabled: true,
  runtime: 'opencode' as const,
  runtimeEnabled: true,
  command: 'opencode',
  commandFound: true,
  keyEnv: null,
  keySet: false,
};

describe('reasons and status', () => {
  it('has no reason for an available access', () => {
    expect(accessReasons(facts)).toEqual([]);
  });

  it('lists every reason in a fixed order', () => {
    expect(
      accessReasons({
        ...facts,
        accessEnabled: false,
        runtimeEnabled: false,
        commandFound: false,
        keyEnv: 'CORP_KEY',
      }),
    ).toEqual([
      'access disabled',
      'runtime opencode is disabled',
      'command opencode not found',
      'variable CORP_KEY is not set',
    ]);
  });

  it('always makes an api access unavailable', () => {
    expect(accessReasons({ ...facts, runtime: null })).toEqual(['api access is not implemented']);
  });

  it('is disabled, available with the first available access, or unavailable', () => {
    const access = [{ available: false }, { available: true }, { available: true }];
    expect(providerStatus(true, access)).toEqual({ status: 'available', active: 1 });
    expect(providerStatus(true, [{ available: false }])).toEqual({
      status: 'unavailable',
      active: null,
    });
    expect(providerStatus(false, access).status).toBe('disabled');
  });
});

const TEXT = `swarm:
  roles:
    think: { name: Think }
    code: { name: Code }
  providers:
    zai:
      name: Z.ai
      access:
        - { kind: cli, runtime: opencode, model_prefix: gproxy/glmcode }
        - { kind: cli, runtime: claude, models: { think: glm-5.3 } }
      models: { think: GLM-5.3 }
    bare: { name: Bare, access: [{ kind: cli, runtime: claude }] }
`;

describe('the role × provider matrix', () => {
  const config = parseConfig(TEXT);

  it('has a cell for every role and provider, empty where there is no model', () => {
    const cells = modelMatrix(config.roles, config.providers);
    expect(cells.map((cell) => `${cell.role}×${cell.provider}`)).toEqual([
      'think×zai',
      'think×bare',
      'code×zai',
      'code×bare',
    ]);
    const think = cells[0]!;
    expect(think.model).toEqual({ model: 'GLM-5.3' });
    expect(think.access).toEqual([
      { index: 0, model: { model: 'gproxy/glmcode/GLM-5.3' } },
      { index: 1, model: { model: 'glm-5.3' } },
    ]);
    expect(cells[2]).toMatchObject({ role: 'code', provider: 'zai', model: null });
  });

  it('names the roles a provider has no model for', () => {
    expect(emptyRoles(config.roles, config.providers[0]!)).toEqual(['code']);
    expect(emptyRoles(config.roles, config.providers[1]!)).toEqual(['think', 'code']);
  });
});

function executable(directory: string, name: string, body = '#!/bin/sh\nexit 0\n'): string {
  const path = join(directory, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

function services(
  environment: NodeJS.ProcessEnv,
  commands: CommandRunner = () => Promise.reject(new Error('must not run')),
): AgentsServices {
  return createAgentsServices({
    environment,
    factories: {
      claude: createClaudeRuntime,
      opencode: createOpencodeRuntime,
      agy: createAgyRuntime,
      codex: createCodexRuntime,
      kilo: createKiloRuntime,
      cline: createClineRuntime,
      copilot: createCopilotRuntime,
    },
    naming: { parse: () => null },
    commands,
  });
}

function stateOf(text: string, environment: NodeJS.ProcessEnv, slug = 'p') {
  const config = parseConfig(text);
  const state = services(environment).providers.status(config);
  return state.find((item) => item.slug === slug)!;
}

const one = (access: string, extra = ''): string =>
  `swarm:\n${extra}  providers:\n    p: { name: P, access: [${access}] }\n`;

describe('the availability of an access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aip-prov-'));
  const fake = executable(directory, 'fake-opencode');

  it('is available when the variable of the runtime names an executable, with no enabled flag', () => {
    const state = stateOf(one('{ kind: cli, runtime: opencode, model_prefix: zai }'), {
      AIP_OPENCODE_BIN: fake,
    });
    expect(state.status).toBe('available');
    expect(state.active).toBe(0);
    expect(state.access[0]).toMatchObject({ available: true, command: fake, reasons: [] });
  });

  it('prefers the variable of the runtime to the command of the access', () => {
    const state = stateOf(
      one(`{ kind: cli, runtime: opencode, model_prefix: zai, command: /opt/none/opencode }`),
      { AIP_OPENCODE_BIN: fake },
    );
    expect(state.access[0]).toMatchObject({ command: fake, available: true });
  });

  it('prefers the command of the access to runtimes.<runtime>.command', () => {
    const own = executable(directory, 'own-opencode');
    const state = stateOf(
      one(
        `{ kind: cli, runtime: opencode, model_prefix: zai, command: ${own} }`,
        `  runtimes:\n    opencode: { enabled: true, command: /usr/local/bin/none }\n`,
      ),
      {},
    );
    expect(state.access[0]).toMatchObject({ command: own, available: true });
  });

  it('takes the command of the runtime settings, then the runtime name', () => {
    const state = stateOf(
      one(
        '{ kind: cli, runtime: opencode, model_prefix: zai }',
        `  runtimes:\n    opencode: { enabled: true, command: ${fake} }\n`,
      ),
      {},
    );
    expect(state.access[0]).toMatchObject({ command: fake, available: true });
    const named = stateOf(
      one(
        '{ kind: cli, runtime: opencode, model_prefix: zai }',
        `  runtimes:\n    opencode: { enabled: true }\n`,
      ),
      { PATH: directory },
    );
    expect(named.access[0]).toMatchObject({ command: 'opencode', available: false });
    expect(named.access[0]!.reasons).toEqual(['command opencode not found']);
  });

  it('is unavailable with the reason when the runtime is switched off', () => {
    const state = stateOf(
      one(
        '{ kind: cli, runtime: opencode, model_prefix: zai }',
        `  runtimes:\n    opencode: { enabled: false, command: ${fake} }\n`,
      ),
      {},
    );
    expect(state.status).toBe('unavailable');
    expect(state.access[0]!.reasons).toEqual(['runtime opencode is disabled']);
  });

  it('is off without the flag and without the variable of the runtime', () => {
    const state = stateOf(one('{ kind: cli, runtime: opencode, model_prefix: zai }'), {
      PATH: directory,
    });
    expect(state.access[0]!.reasons).toContain('runtime opencode is disabled');
  });

  it('needs the variable of the key in the daemon environment or runtimes.<runtime>.env, never printing it', () => {
    const text = one(
      '{ kind: cli, runtime: codex, endpoint: { base_url: "https://llm.example/v1", key_env: CORP_KEY } }',
      `  runtimes:\n    codex: { enabled: true, command: ${fake} }\n`,
    );
    const missing = stateOf(text, {});
    expect(missing.status).toBe('unavailable');
    expect(missing.access[0]!.reasons).toEqual(['variable CORP_KEY is not set']);
    expect(stateOf(text, { CORP_KEY: 'secret-value' }).status).toBe('available');
    const inSettings = stateOf(
      text.replace('{ enabled: true,', '{ env: { CORP_KEY: secret-value }, enabled: true,'),
      {},
    );
    expect(inSettings.status).toBe('available');
    expect(JSON.stringify(inSettings)).not.toContain('secret-value');
    expect(JSON.stringify(stateOf(text, { CORP_KEY: 'secret-value' }))).not.toContain(
      'secret-value',
    );
  });

  it('is unavailable for an api access, with the reason', () => {
    const state = stateOf(
      one('{ kind: api, endpoint: { base_url: "https://api.openai.com/v1", key_env: K } }'),
      { K: 'x' },
    );
    expect(state.access[0]).toMatchObject({
      kind: 'api',
      available: false,
      reasons: ['api access is not implemented'],
    });
  });

  it('takes the second access when the first is not available', () => {
    const state = stateOf(
      one(`{ kind: cli, runtime: claude }, { kind: cli, runtime: opencode, model_prefix: zai }`),
      { AIP_OPENCODE_BIN: fake, PATH: '/nonexistent' },
    );
    expect(state.status).toBe('available');
    expect(state.active).toBe(1);
    expect(state.access[0]!.reasons).toEqual([
      'runtime claude is disabled',
      'command claude not found',
    ]);
  });

  it('is disabled for a switched-off provider, and lists providers by slug', () => {
    const config = parseConfig(
      `swarm:\n  providers:\n    b: { name: B, enabled: false, access: [{ kind: cli, runtime: claude }] }\n    a: { name: A, access: [{ kind: cli, runtime: claude }] }\n`,
    );
    const states = services({}).providers.status(config);
    expect(states.map((state) => [state.slug, state.status])).toEqual([
      ['a', 'unavailable'],
      ['b', 'disabled'],
    ]);
  });

  it('starts nothing', () => {
    const calls: string[] = [];
    const agents = services({ AIP_OPENCODE_BIN: fake }, (file) => {
      calls.push(file);
      return Promise.resolve({ stdout: '' });
    });
    agents.providers.status(
      parseConfig(one('{ kind: cli, runtime: opencode, model_prefix: zai }')),
    );
    expect(calls).toEqual([]);
  });
});

describe('the models of a provider', () => {
  const CATALOG = [
    'gproxy/glmcode/GLM-5.3',
    'gproxy/glmcode/GLM-5.3-Flash',
    'gproxy/codex/gpt-6.1-terra',
  ].join('\n');

  async function modelsOf(config: ResolvedConfig, runner: CommandRunner) {
    const agents = services({ AIP_OPENCODE_BIN: '/bin/opencode' }, runner);
    return agents.providers.models('/repo', config, config.providers[0]!);
  }

  it('filters the opencode catalog by the prefix and drops it from the ids', async () => {
    const config = parseConfig(
      one('{ kind: cli, runtime: opencode, model_prefix: gproxy/glmcode }'),
    );
    const [access] = await modelsOf(config, () => Promise.resolve({ stdout: CATALOG }));
    expect(access!.models.map((model) => model.id)).toEqual(['GLM-5.3', 'GLM-5.3-Flash']);
    expect(access).toMatchObject({ index: 0, runtime: 'opencode', error: null, manual: false });
  });

  it('gives the whole catalog without a prefix', async () => {
    const config = parseConfig(one('{ kind: cli, runtime: opencode }'));
    const [access] = await modelsOf(config, () => Promise.resolve({ stdout: CATALOG }));
    expect(access!.models).toHaveLength(3);
  });

  it('gives the built-in list of claude without running anything', async () => {
    const config = parseConfig(one('{ kind: cli, runtime: claude }'));
    const [access] = await modelsOf(config, () => Promise.reject(new Error('must not run')));
    expect(access!.models.map((model) => model.id)).toContain('opus');
    expect(access).toMatchObject({ runtime: 'claude', manual: false, error: null });
  });

  it('is empty and manual for other runtimes and for api', async () => {
    const config = parseConfig(
      one(
        '{ kind: cli, runtime: codex }, { kind: api, endpoint: { base_url: "https://x.example", key_env: K } }',
      ),
    );
    const access = await modelsOf(config, () => Promise.reject(new Error('must not run')));
    expect(access).toEqual([
      { index: 0, runtime: 'codex', models: [], error: null, manual: true },
      { index: 1, runtime: null, models: [], error: null, manual: true },
    ]);
  });

  it('keeps the error of one access out of the others', async () => {
    const config = parseConfig(
      one('{ kind: cli, runtime: opencode, model_prefix: zai }, { kind: cli, runtime: claude }'),
    );
    const access = await modelsOf(config, () => Promise.reject(new Error('boom')));
    expect(access[0]!.error).toContain('boom');
    expect(access[1]).toMatchObject({ error: null });
    expect(access[1]!.models.length).toBeGreaterThan(0);
  });
});
