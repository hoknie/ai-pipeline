import { describe, expect, it } from 'vitest';

import { MANUAL_CONFIG } from '../daemon/harness.ts';
import { aip, sandbox } from './sandbox.ts';

const REGISTRY = `  roles:
    think: { name: Think }
    code: { name: Code }
    light: { name: Light }
  providers:
    zai:
      name: Z.ai
      access:
        - { kind: api, endpoint: { base_url: "https://api.example/v1", key_env: ZAI_API_KEY } }
        - { kind: cli, runtime: opencode, model_prefix: gproxy/glmcode }
      models:
        think: GLM-5.3
        code: { model: GLM-5.3-Flash, reasoning_effort: high }
    corp:
      name: Corp
      access:
        - { kind: cli, runtime: codex, endpoint: { base_url: "https://llm.example/v1", key_env: CORP_KEY } }
      models: { think: gpt-6.1 }
    off:
      name: Off
      enabled: false
      access: [{ kind: cli, runtime: claude }]
`;

const CONFIG = MANUAL_CONFIG.replace('  specialists:\n', `${REGISTRY}  specialists:\n`);

describe('aip provider list', () => {
  it('prints a table with name, status, effective runtime and filled roles', async () => {
    const box = sandbox(CONFIG);
    const result = await aip(box, 'provider', 'list');
    expect(result.code, result.stderr).toBe(0);
    const [header, ...rows] = result.stdout.trim().split('\n');
    expect(header).toMatch(/SLUG\s+NAME\s+STATUS\s+ACCESS\s+ROLES/);
    const zai = rows.find((row) => row.startsWith('zai'))!;
    expect(zai).toContain('Z.ai');
    expect(zai).toContain('available');
    expect(zai).toContain('opencode');
    expect(zai).toMatch(/2\/3\s*$/);
    expect(rows.find((row) => row.startsWith('corp'))).toMatch(/unavailable\s+—\s+1\/3/);
    expect(rows.find((row) => row.startsWith('off'))).toMatch(/disabled/);
  });

  it('prints the data of config_providers with --json', async () => {
    const box = sandbox(CONFIG);
    const result = await aip(box, 'provider', 'list', '--json');
    expect(result.code, result.stderr).toBe(0);
    const view = JSON.parse(result.stdout) as {
      roles: { slug: string }[];
      providers: { slug: string; status: string }[];
      matrix: unknown[];
    };
    expect(view.roles.map((role) => role.slug)).toEqual(['think', 'code', 'light']);
    expect(view.providers.map((provider) => provider.slug)).toEqual(['corp', 'off', 'zai']);
    expect(view.matrix).toHaveLength(9);
  });

  it('fails with code 1 and the errors when the configuration does not load', async () => {
    const box = sandbox(CONFIG.replace('model_prefix: gproxy/glmcode', 'model_prefix: "/x"'));
    const result = await aip(box, 'provider', 'list');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('swarm.providers.zai.access[1].model_prefix');
  });
});

describe('aip provider show', () => {
  it('prints the access routes with reasons, the full model ids and the empty roles', async () => {
    const box = sandbox(CONFIG);
    const result = await aip(box, 'provider', 'show', 'zai');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('zai (Z.ai)');
    expect(result.stdout).toContain('Status: available');
    expect(result.stdout).toContain('api api · unavailable');
    expect(result.stdout).toContain('api access is not implemented');
    expect(result.stdout).toContain('opencode · available · effective');
    expect(result.stdout).toContain('think: gproxy/glmcode/GLM-5.3');
    expect(result.stdout).toContain('code: gproxy/glmcode/GLM-5.3-Flash (effort high)');
    expect(result.stdout).toContain('Empty roles: light');
    expect(result.stdout).not.toContain('ZAI_API_KEY=');
  });

  it('names the missing variable of a key and never its value', async () => {
    const box = sandbox(CONFIG);
    const result = await aip(box, 'provider', 'show', 'corp');
    expect(result.stdout).toContain('Status: unavailable');
    expect(result.stdout).toContain('variable CORP_KEY is not set');
    expect(result.stdout).toContain('key variable CORP_KEY');
  });

  it('prints the provider of config_providers with --json', async () => {
    const box = sandbox(CONFIG);
    const result = await aip(box, 'provider', 'show', 'zai', '--json');
    const view = JSON.parse(result.stdout) as { slug: string; status: string; active: number };
    expect(view).toMatchObject({ slug: 'zai', status: 'available', active: 1 });
  });

  it('fails with code 1 for an unknown provider naming the known ones', async () => {
    const box = sandbox(CONFIG);
    const result = await aip(box, 'provider', 'show', 'nope');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'unknown provider `nope`; known: corp (Corp), off (Off), zai (Z.ai)',
    );
  });
});

describe('aip config check with providers', () => {
  it('prints the roles, the providers with status and the warnings of empty cells', async () => {
    const box = sandbox(CONFIG);
    const result = await aip(box, 'config', 'check');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Roles:\n  think: Think\n  code: Code\n  light: Light');
    expect(result.stdout).toContain('zai (Z.ai) · project · enabled · available');
    expect(result.stdout).toContain('off (Off) · project · disabled · disabled');
    expect(result.stdout).toContain('key variable CORP_KEY');
    expect(result.stdout).toContain('Warning: provider `zai` has no model for role `light`');
    expect(result.stdout).toContain('Warning: provider `corp` has no model for role `code`');
    expect(result.stdout).not.toContain('provider `off` has no model');
  });

  it('lists the files of providers/ between chains and pipelines', async () => {
    const box = sandbox(CONFIG);
    const result = await aip(box, 'config', 'check');
    const files = result.stdout.split('Config files:\n')[1]!.split('\n\n')[0]!;
    const order = ['settings.yaml', 'specialists/', 'providers/corp.yaml', 'pipelines/'];
    let last = -1;
    for (const part of order) {
      const index = files.indexOf(part);
      expect(index, part).toBeGreaterThan(last);
      last = index;
    }
  });
});
