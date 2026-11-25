import { describe, expect, it } from 'vitest';

import { createAccessServices } from '../../src/feature/access/services/index.ts';
import { ConfigService } from '../../src/feature/swarm-config/services/index.ts';
import { guard, methodActions } from '../../src/presentation/ipc/handlers/access/index.ts';
import { requestSchema, type Request } from '../../src/presentation/ipc/contract/index.ts';
import type { Actor } from '../../src/feature/identity/types/index.ts';
import type { IpcContext } from '../../src/presentation/ipc/handlers/types.ts';

const developer: Actor = {
  kind: 'user',
  user: { id: 'u1', email: 'bob@example.com', name: 'bob' },
  attributes: { role: ['developer'] },
};
const admin: Actor = { ...developer, attributes: { role: ['admin'] } };

const access = createAccessServices({
  config: new ConfigService({ environment: { XDG_CONFIG_HOME: '/nonexistent-aip-config' } }),
  registry: { entries: () => [], entry: () => undefined } as never,
  users: { list: () => [] },
  now: () => 0,
  log: () => undefined,
}).access;

function context(actor: Actor, mode = 'branch'): IpcContext {
  return {
    actor,
    services: {
      access,
      registry: { entries: () => [], entry: () => undefined },
      tags: { of: () => [] },
      queue: { store: { findItem: () => undefined } },
      runs: {
        states: {
          lookup: (id: string) =>
            id === 'r1'
              ? {
                  run: {
                    repository: '/x',
                    author: null,
                    pipeline: 'feature',
                    tags: [],
                    config: { delivery: { mode } },
                  },
                }
              : undefined,
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
      expect(() => guard(parsed.data, context(developer)), method).toThrow(/access denied/);
      expect(() => guard(parsed.data, context(admin)), method).not.toThrow();
      expect(() => guard(parsed.data, context({ kind: 'system' })), method).not.toThrow();
      expect(() => guard(parsed.data, context({ kind: 'local' })), method).not.toThrow();
    }
  });

  it('names the action of every method of the contract, and no other method', () => {
    const known = requestSchema.options.map((option) => option.shape.method.value as string);
    expect(Object.keys(methodActions).sort()).toEqual([...known].sort());
  });

  it('answers a refusal with the code access.denied and the action', () => {
    const call = parse('repository_move', { path: '/x', to: '/y' });
    try {
      guard(call, context(developer));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ kind: 'forbidden', responseCode: 'access.denied' });
      expect((error as Error).message).toContain('project.update');
    }
  });

  it('refuses a viewer every call that changes something', () => {
    const viewer: Actor = { ...developer, attributes: { role: ['viewer'] } };
    for (const [method, params] of ADMIN_CALLS) {
      const parsed = requestSchema.parse({ method, params });
      expect(() => guard(parsed, context(viewer)), method).toThrow(/access denied/);
    }
    expect(() => guard(parse('whoami', {}), context(viewer))).not.toThrow();
    expect(() => guard(parse('tokens_list', {}), context(viewer))).not.toThrow();
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

  it('lets a user apply a run of any delivery mode: the settings check refuses the modes', () => {
    const apply = parse('apply', { runId: 'r1' });
    for (const mode of ['branch', 'worktree', 'commit']) {
      expect(() => guard(apply, context(developer, mode))).not.toThrow();
    }
  });

  it('guards a contrast probe as starting a run: a developer may probe, a viewer may not', () => {
    const call = parse('run_contrast', {
      runId: 'r1',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    expect(methodActions.run_contrast.action).toBe('run.start');
    expect(() => guard(call, context(developer))).not.toThrow();
    const viewer: Actor = { ...developer, attributes: { role: ['viewer'] } };
    try {
      guard(call, context(viewer));
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('run.start');
    }
  });
});
