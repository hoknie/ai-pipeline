import { expect, it } from 'vitest';
import {
  permissionsOf,
  refreshPermissions,
  refreshSpecialists,
  specialistsOf,
} from '../../../src/feature/agents/types/permissions.ts';
import { config } from './helpers.ts';

const PROVIDERS = `swarm:
  roles:
    code: { name: Code }
  providers:
    zai: { name: Z.ai, access: [{ kind: cli, runtime: opencode, model_prefix: zai }], models: { code: glm-5.3 } }
  specialists:
    coder: { name: Coder, runtime: opencode, model: anthropic/sonnet }
`;

it('refreshes runtime settings on retries and answers without sharing mutable overrides', () => {
  const current = config();
  current.opencode = { mcp: 'isolated', overrides: { provider: { local: true } } };
  current.agy = { mcp: 'inherit', overrides: { theme: 'dark' } };
  current.claude.overrides = { env: { X: '1' } };
  const refresh = permissionsOf(current);
  const fullRefresh = specialistsOf(current);
  const old = config();
  refreshPermissions(old, refresh);
  expect(old.opencode).toEqual(current.opencode);
  expect(old.agy).toEqual(current.agy);
  expect(old.claude.overrides).toEqual(current.claude.overrides);
  expect(old.opencode.overrides).not.toBe(current.opencode.overrides);
  const other = config();
  refreshSpecialists(other, fullRefresh);
  expect(other.opencode).toEqual(current.opencode);
  expect(other.agy).toEqual(current.agy);
  expect(other.claude.overrides).toEqual(current.claude.overrides);
});

it('replaces the provider registry on a retry with the current configuration', () => {
  const snapshot = config(PROVIDERS);
  const fresh = config(
    PROVIDERS.replace('zai:', 'deepseek:')
      .replace('name: Z.ai', 'name: DeepSeek')
      .replace('model_prefix: zai', 'model_prefix: deepseek')
      .replace('glm-5.3', 'deepseek-chat'),
  );
  refreshSpecialists(snapshot, specialistsOf(fresh));
  expect(snapshot.providers.map((provider) => provider.slug)).toEqual(['deepseek']);
  expect(snapshot.providers[0]?.name).toBe('DeepSeek');
  expect(snapshot.providers[0]?.models.code?.model).toBe('deepseek-chat');
});

it('copies the refreshed provider registry instead of sharing it', () => {
  const snapshot = config(PROVIDERS);
  const fresh = config(PROVIDERS);
  refreshSpecialists(snapshot, specialistsOf(fresh));
  expect(snapshot.providers).toEqual(fresh.providers);
  expect(snapshot.providers).not.toBe(fresh.providers);
  expect(snapshot.providers[0]).not.toBe(fresh.providers[0]);
  expect(snapshot.providers[0]?.access).not.toBe(fresh.providers[0]?.access);
  expect(snapshot.providers[0]?.access[0]).not.toBe(fresh.providers[0]?.access[0]);
  expect(snapshot.providers[0]?.models).not.toBe(fresh.providers[0]?.models);
});
