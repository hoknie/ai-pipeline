import { describe, expect, it } from 'vitest';

import { clearRole, roleModelOf, setRoleModel } from '../src/features/providers/matrix/edit.ts';
import { withoutRole } from '../src/features/providers/roles/removal.ts';
import {
  addRole,
  canMove,
  moveRole,
  movableRoles,
  removeRole,
  renameRole,
  roleRecordOf,
} from '../src/features/providers/roles/edit.ts';

describe('matrix edit', () => {
  it('sets a string model, or an object with options', () => {
    expect(setRoleModel({ name: 'A' }, 'code', 'sonnet')).toEqual({
      name: 'A',
      models: { code: 'sonnet' },
    });
    expect(setRoleModel({}, 'code', 'gpt', { effort: 'high' }).models).toEqual({
      code: { model: 'gpt', reasoning_effort: 'high' },
    });
  });

  it('clears a role and drops empty models', () => {
    expect(clearRole({ name: 'A', models: { code: 'x' } }, 'code')).toEqual({ name: 'A' });
    expect(clearRole({ models: { code: 'x', think: 'y' } }, 'code')).toEqual({
      models: { think: 'y' },
    });
  });

  it('reads the model of a role', () => {
    expect(roleModelOf({ models: { code: { model: 'x', variant: 'v' } } }, 'code')).toEqual({
      model: 'x',
      variant: 'v',
      effort: '',
    });
    expect(roleModelOf({}, 'code')).toBeNull();
  });
});

describe('role edit', () => {
  const roles = roleRecordOf({ think: { name: 'Think' }, code: { name: 'Code' }, light: {} });

  it('reads, adds, renames and removes', () => {
    expect(Object.keys(roles)).toEqual(['think', 'code', 'light']);
    expect(roles.light?.name).toBe('light');
    expect(Object.keys(addRole(roles, 'qa', 'QA')).at(-1)).toBe('qa');
    expect(renameRole(roles, 'code', 'Coding').code?.name).toBe('Coding');
    expect(Object.keys(removeRole(roles, 'code'))).toEqual(['think', 'light']);
  });

  it('moves within the movable roles; shared roles are fixed at the project level', () => {
    const own = roleRecordOf({ think: {}, extra: {}, more: {} });
    const shared = roleRecordOf({ think: {} });
    const movable = movableRoles('project', own, shared);
    expect(movable).toEqual(['extra', 'more']);
    expect(canMove(movable, 'extra', -1)).toBe(false);
    expect(Object.keys(moveRole(own, movable, 'more', -1))).toEqual(['think', 'more', 'extra']);
  });
});

describe('withoutRole', () => {
  it('removes the role from the provider and its accesses', () => {
    const raw = {
      name: 'A',
      models: { code: 'x' },
      access: [{ runtime: 'claude', models: { code: 'y', think: 'z' } }, { runtime: 'codex' }],
    };
    expect(withoutRole(raw, 'code')).toEqual({
      name: 'A',
      access: [{ runtime: 'claude', models: { think: 'z' } }, { runtime: 'codex' }],
    });
  });
});
