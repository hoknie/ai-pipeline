import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { actionNames, similarActions } from '../../../src/feature/access/types/index.ts';
import {
  ConfigService,
  loadAccessPolicy,
  validateAccessPolicy,
} from '../../../src/feature/swarm-config/services/index.ts';
import { validateServerSection } from '../../../src/feature/swarm-config/services/sections/server.ts';
import { ConfigLoadError, defaultWeb } from '../../../src/feature/swarm-config/types/index.ts';

const catalog = { names: actionNames(), similar: (name: string) => similarActions(name) };

const paths = (value: unknown) => validateAccessPolicy(value, catalog).errors.map((e) => e.path);

describe('the content of access.yaml', () => {
  it('reads presets and rules', () => {
    const { policy, errors } = validateAccessPolicy(
      {
        presets: false,
        rules: [
          {
            id: 'payments-own-projects',
            effect: 'allow',
            actions: ['queue.*', 'run.*'],
            subject: { groups: ['payments'] },
            resource: { repository: ['billing', 'ledger'], author: 'self' },
          },
        ],
      },
      catalog,
    );
    expect(errors).toEqual([]);
    expect(policy.presets).toBe(false);
    expect(policy.rules[0]).toMatchObject({
      id: 'payments-own-projects',
      effect: 'allow',
      subject: { groups: ['payments'] },
      resource: { repository: ['billing', 'ledger'], author: 'self' },
    });
  });

  it('is an empty policy with presets when the file is empty', () => {
    expect(validateAccessPolicy(undefined, catalog)).toEqual({
      policy: { presets: true, rules: [] },
      errors: [],
    });
  });

  it('names the field and the close actions of an unknown action', () => {
    const { errors } = validateAccessPolicy(
      { rules: [{ id: 'x', effect: 'allow', actions: ['run.destroy'] }] },
      catalog,
    );
    expect(errors.map((e) => e.path)).toEqual(['rules[0].actions[0]']);
    expect(errors[0]?.message).toContain('run.cancel');
  });

  it('refuses a pattern that covers nothing', () => {
    expect(paths({ rules: [{ id: 'x', effect: 'deny', actions: ['nothing.*'] }] })).toEqual([
      'rules[0].actions[0]',
    ]);
  });

  it('names the path of every other mistake', () => {
    expect(paths({ rulez: [] })).toEqual(['rulez']);
    expect(paths({ rules: {} })).toEqual(['rules']);
    expect(paths({ presets: 'yes' })).toEqual(['presets']);
    expect(paths({ rules: [{ effect: 'allow', actions: ['*'] }] })).toEqual(['rules[0].id']);
    expect(paths({ rules: [{ id: 'a', effect: 'maybe', actions: ['*'] }] })).toEqual([
      'rules[0].effect',
    ]);
    expect(paths({ rules: [{ id: 'a', effect: 'allow', actions: ['*'], when: 1 }] })).toEqual([
      'rules[0].when',
    ]);
    expect(
      paths({
        rules: [{ id: 'a', effect: 'allow', actions: ['*'], resource: { author: 'other' } }],
      }),
    ).toEqual(['rules[0].resource.author']);
    expect(
      paths({ rules: [{ id: 'a', effect: 'allow', actions: ['*'], resource: { colour: ['x'] } }] }),
    ).toEqual(['rules[0].resource.colour']);
    expect(
      paths({ rules: [{ id: 'a', effect: 'allow', actions: ['*'], subject: { groups: 'x' } }] }),
    ).toEqual(['rules[0].subject.groups']);
    expect(
      paths({
        rules: [
          { id: 'a', effect: 'allow', actions: ['*'] },
          { id: 'a', effect: 'deny', actions: ['*'] },
        ],
      }),
    ).toEqual(['rules[1].id']);
  });
});

describe('access.yaml on disk', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'aip-access-file-'));
    mkdirSync(join(home, 'aip'), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const load = () =>
    loadAccessPolicy(
      new ConfigService({ environment: { XDG_CONFIG_HOME: home } }).pathsOf('.'),
      catalog,
    );

  it('is the default policy when the file is missing', () => {
    expect(load()).toEqual({ presets: true, rules: [] });
  });

  it('throws the errors with their paths and the file', () => {
    writeFileSync(
      join(home, 'aip', 'access.yaml'),
      'rules:\n  - id: a\n    effect: allow\n    actions: [run.destroy]\n',
    );
    expect(() => load()).toThrow(ConfigLoadError);
    expect(() => load()).toThrow(/rules\[0\]\.actions\[0\]/);
  });

  it('throws a syntax error', () => {
    writeFileSync(join(home, 'aip', 'access.yaml'), 'rules: [oops');
    expect(() => load()).toThrow(ConfigLoadError);
  });
});

describe('server.default_role', () => {
  it('takes the three roles and none by default', () => {
    for (const role of ['admin', 'developer', 'viewer']) {
      const { server, errors } = validateServerSection({ default_role: role }, defaultWeb());
      expect(errors).toEqual([]);
      expect(server.defaultRole).toBe(role);
    }
    expect(validateServerSection({}, defaultWeb()).server.defaultRole).toBeNull();
  });

  it('names the path and the roles of an unknown role', () => {
    const { errors } = validateServerSection({ default_role: 'owner' }, defaultWeb());
    expect(errors.map((e) => e.path)).toEqual(['swarm.server.default_role']);
    expect(errors[0]?.message).toContain('admin, developer, viewer');
  });

  it('names the path of a role of a wrong type', () => {
    const { errors } = validateServerSection({ default_role: ['developer'] }, defaultWeb());
    expect(errors.map((e) => e.path)).toEqual(['swarm.server.default_role']);
  });
});
