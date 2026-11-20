import { expect, it } from 'vitest';
import {
  permissionsOf,
  refreshPermissions,
  refreshSpecialists,
  specialistsOf,
} from '../../../src/feature/agents/types/permissions.ts';
import { config } from './helpers.ts';

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
