import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  ProviderModelsView,
  ProvidersView,
} from '../../src/presentation/ipc/contract/index.ts';
import { start } from './control-harness.ts';

const CONFIG = `swarm:
  max: 3
  roles:
    think: { name: Think }
    code: { name: Code }
  providers:
    zai:
      name: Z.ai
      access:
        - { kind: api, endpoint: { base_url: "https://api.example/v1", key_env: ZAI_API_KEY } }
        - { kind: cli, runtime: opencode, model_prefix: gproxy/glmcode }
      models: { think: GLM-5.3 }
    off:
      name: Off
      enabled: false
      access: [{ kind: cli, runtime: claude }]
  specialists:
    coder: { name: Coder }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;

function fakeOpencode(): string {
  const directory = mkdtempSync(join(tmpdir(), 'aip-fake-opencode-'));
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'opencode');
  writeFileSync(
    path,
    '#!/bin/sh\nprintf "gproxy/glmcode/GLM-5.3\\ngproxy/glmcode/GLM-5.3-Flash\\ngproxy/codex/gpt-6.1-terra\\n"\n',
  );
  chmodSync(path, 0o755);
  return path;
}

describe('config_providers', () => {
  it('answers with the roles, the providers with status and the matrix with an empty cell', async () => {
    const h = await start(CONFIG, { AIP_OPENCODE_BIN: fakeOpencode() });
    const view = (await h.call('config_providers', { repository: h.repo })) as ProvidersView;
    expect(view.errors).toEqual([]);
    expect(view.roles.map((role) => [role.slug, role.name])).toEqual([
      ['think', 'Think'],
      ['code', 'Code'],
    ]);
    const zai = view.providers.find((provider) => provider.slug === 'zai')!;
    expect(zai).toMatchObject({ name: 'Z.ai', status: 'available', active: 1, enabled: true });
    expect(zai.file).toMatch(/providers\/zai\.yaml$/);
    expect(zai.access[0]).toMatchObject({
      kind: 'api',
      available: false,
      reasons: ['api access is not implemented'],
      endpoint: { baseUrl: 'https://api.example/v1', keyEnv: 'ZAI_API_KEY' },
    });
    expect(zai.access[1]).toMatchObject({ runtime: 'opencode', available: true });
    expect(view.providers.find((provider) => provider.slug === 'off')?.status).toBe('disabled');
    const cell = (role: string, provider: string) =>
      view.matrix.find((item) => item.role === role && item.provider === provider);
    expect(cell('think', 'zai')?.model).toEqual({ model: 'GLM-5.3' });
    expect(cell('think', 'zai')?.access[1]?.model).toEqual({ model: 'gproxy/glmcode/GLM-5.3' });
    expect(cell('code', 'zai')?.model).toBeNull();
  });

  it('answers with the errors and empty lists when the configuration does not load', async () => {
    const h = await start(CONFIG.replace('model_prefix: gproxy/glmcode', 'model_prefix: "/x"'));
    const view = (await h.call('config_providers', { repository: h.repo })) as ProvidersView;
    expect(view.errors.length).toBeGreaterThan(0);
    expect(view).toMatchObject({ roles: [], providers: [], matrix: [] });
  });

  it('never carries the value of a key variable', async () => {
    const h = await start(CONFIG, { ZAI_API_KEY: 'top-secret-value' });
    const view = await h.call('config_providers', { repository: h.repo });
    expect(JSON.stringify(view)).not.toContain('top-secret-value');
  });
});

describe('provider_models', () => {
  it('lists the models of every access, filtered by the prefix of the access', async () => {
    const h = await start(CONFIG, { AIP_OPENCODE_BIN: fakeOpencode() });
    const view = (await h.call('provider_models', {
      repository: h.repo,
      provider: 'zai',
    })) as ProviderModelsView;
    expect(view.provider).toBe('zai');
    expect(view.access[0]).toMatchObject({ index: 0, runtime: null, models: [], manual: true });
    expect(view.access[1]?.models.map((model) => model.id)).toEqual(['GLM-5.3', 'GLM-5.3-Flash']);
    expect(view.access[1]).toMatchObject({ runtime: 'opencode', error: null, manual: false });
  });

  it('refuses an unknown provider naming the known ones', async () => {
    const h = await start(CONFIG);
    await expect(
      h.call('provider_models', { repository: h.repo, provider: 'nope' }),
    ).rejects.toThrow('unknown provider `nope`; known: off (Off), zai (Z.ai)');
  });
});
