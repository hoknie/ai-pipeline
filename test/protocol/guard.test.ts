import { describe, expect, it } from 'vitest';

import { adminMethods, guard } from '../../src/presentation/ipc/handlers/identity/index.ts';
import { requestSchema, type Request } from '../../src/presentation/ipc/contract/index.ts';
import type { Actor } from '../../src/feature/identity/types/index.ts';
import type { IpcContext } from '../../src/presentation/ipc/handlers/types.ts';

const developer: Actor = {
  kind: 'user',
  user: { id: 'u1', email: 'bob@example.com', name: 'bob' },
  attributes: { role: ['dev'] },
};
const admin: Actor = { ...developer, attributes: { role: ['admin'] } };

function context(actor: Actor, mode = 'branch'): IpcContext {
  return {
    actor,
    services: {
      runs: {
        states: {
          lookup: (id: string) =>
            id === 'r1' ? { run: { config: { delivery: { mode } } } } : undefined,
        },
      },
    },
  } as unknown as IpcContext;
}

function parse(method: string, params: unknown): Request {
  return requestSchema.parse({ method, params });
}

const ADMIN_CALLS: [string, unknown][] = [
  ['users_list', {}],
  ['users_set', { email: 'a@example.com', attributes: {} }],
  ['users_disable', { email: 'a@example.com' }],
  ['users_enable', { email: 'a@example.com' }],
  ['login_link_create', { email: 'a@example.com' }],
  ['repository_add', { path: '/x' }],
  ['repository_update', { path: '/x', name: 'n' }],
  ['repository_move', { path: '/x', to: '/y' }],
  ['repository_remove', { path: '/x' }],
  [
    'config_write',
    { repository: '/x', kind: 'specialist', id: 'dev', value: {}, revision: null, level: 'global' },
  ],
  [
    'config_delete',
    { repository: '/x', kind: 'specialist', id: 'dev', revision: 'r', level: 'global' },
  ],
  ['config_setting', { repository: '/x', path: 'max', value: 2, revision: null }],
  ['config_settings', { repository: '/x', values: { max: 2 }, revision: null }],
  ['specialist_tags_set', { repository: null, slug: 'dev', tags: [], revision: null }],
  ['specialist_tag_rename', { repository: null, from: 'a', to: 'b' }],
  ['specialist_tag_remove', { repository: null, tag: 'a' }],
  ['specialists_import', { repository: '/x', source: '/y', slugs: ['dev'] }],
  ['pipelines_import', { repository: '/x', source: '/y', ids: ['feature'] }],
  ['observers_set', { settings: {} }],
  ['stats_clear', { repository: '/x' }],
];

describe('guard', () => {
  it('refuses every listed administrator call to a user without the role and lets others in', () => {
    for (const [method, params] of ADMIN_CALLS) {
      const parsed = requestSchema.safeParse({ method, params });
      expect(parsed.success, `${method} params`).toBe(true);
      if (!parsed.success) continue;
      expect(() => guard(parsed.data, context(developer)), method).toThrow(
        /needs an administrator/,
      );
      expect(() => guard(parsed.data, context(admin)), method).not.toThrow();
      expect(() => guard(parsed.data, context({ kind: 'system' })), method).not.toThrow();
      expect(() => guard(parsed.data, context({ kind: 'local' })), method).not.toThrow();
    }
  });

  it('keeps every listed method in the contract', () => {
    const known = new Set(
      requestSchema.options.map((option) => option.shape.method.value as string),
    );
    for (const method of Object.keys(adminMethods)) expect(known.has(method), method).toBe(true);
  });

  it('lets a user write the project level of the settings', () => {
    const project = parse('config_setting', {
      repository: '/x',
      path: 'max',
      value: 2,
      revision: null,
      level: 'project',
    });
    expect(() => guard(project, context(developer))).not.toThrow();
  });

  it('delivers for a user only by a branch', () => {
    const apply = parse('apply', { runId: 'r1' });
    expect(() => guard(apply, context(developer, 'branch'))).not.toThrow();
    for (const mode of ['worktree', 'commit']) {
      expect(() => guard(apply, context(developer, mode))).toThrow(/by a branch/);
    }
    expect(() => guard(apply, context({ kind: 'system' }, 'worktree'))).not.toThrow();
  });
});
