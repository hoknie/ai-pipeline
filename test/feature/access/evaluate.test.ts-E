import { describe, expect, it } from 'vitest';

import { evaluate, type Subject } from '../../../src/feature/access/types/index.ts';
import type { AccessPolicy, AccessRule } from '../../../src/feature/swarm-config/types/index.ts';

const rule = (partial: Partial<AccessRule> & Pick<AccessRule, 'id' | 'effect' | 'actions'>) =>
  ({ subject: {}, resource: {}, ...partial }) as AccessRule;

const policy = (rules: AccessRule[], presets = true): AccessPolicy => ({ presets, rules });

const bob: Subject = { id: 'bob', attributes: { role: ['developer'], groups: ['payments'] } };
const alice: Subject = { id: 'alice', attributes: { role: ['developer'] } };

describe('the order of the decision', () => {
  it('refuses a deny above an allow of a preset', () => {
    const rules = [
      rule({
        id: 'contractors-no-apply',
        effect: 'deny',
        actions: ['run.apply'],
        subject: { groups: ['contractors'] },
      }),
    ];
    const contractor = { id: 'c', attributes: { role: ['developer'], groups: ['contractors'] } };
    const decision = evaluate(policy(rules), contractor, 'run.apply', { repository: 'billing' });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('deny');
    expect(decision.matched.map((match) => match.id)).toEqual([
      'preset:developer',
      'contractors-no-apply',
    ]);
    expect(evaluate(policy(rules), alice, 'run.apply', { repository: 'billing' }).effect).toBe(
      'allow',
    );
  });

  it('does not depend on the order of the rules', () => {
    const allow = rule({ id: 'a', effect: 'allow', actions: ['run.*'] });
    const deny = rule({ id: 'd', effect: 'deny', actions: ['run.cancel'] });
    const first = evaluate(policy([allow, deny], false), bob, 'run.cancel', {});
    const second = evaluate(policy([deny, allow], false), bob, 'run.cancel', {});
    expect(first.effect).toBe('deny');
    expect(second.effect).toBe('deny');
  });

  it('refuses by default and says so', () => {
    const decision = evaluate(policy([], false), bob, 'run.cancel', {});
    expect(decision).toEqual({ effect: 'deny', matched: [], reason: 'default' });
  });
});

describe('the conditions of a rule', () => {
  it('lets only the author cancel with `author: self`', () => {
    const only = policy(
      [rule({ id: 'own', effect: 'allow', actions: ['run.cancel'], resource: { author: 'self' } })],
      false,
    );
    expect(evaluate(only, bob, 'run.cancel', { author: 'alice' }).effect).toBe('deny');
    expect(evaluate(only, bob, 'run.cancel', { author: 'bob' }).effect).toBe('allow');
    expect(evaluate(only, bob, 'run.cancel', { author: null }).effect).toBe('deny');
    expect(evaluate(only, bob, 'run.cancel', {}).effect).toBe('deny');
  });

  it('matches the group and the project', () => {
    const payments = policy(
      [
        rule({
          id: 'payments-own-projects',
          effect: 'allow',
          actions: ['queue.*'],
          subject: { groups: ['payments'] },
          resource: { repository: ['billing', 'ledger'] },
        }),
      ],
      false,
    );
    expect(evaluate(payments, bob, 'queue.add', { repository: 'billing' }).effect).toBe('allow');
    expect(evaluate(payments, bob, 'queue.add', { repository: 'app' }).effect).toBe('deny');
    expect(evaluate(payments, alice, 'queue.add', { repository: 'billing' }).effect).toBe('deny');
    expect(evaluate(payments, bob, 'queue.add', {}).effect).toBe('deny');
  });

  it('takes `*` for any project but needs a project', () => {
    const any = policy(
      [rule({ id: 'x', effect: 'allow', actions: ['run.*'], resource: { repository: ['*'] } })],
      false,
    );
    expect(evaluate(any, bob, 'run.cancel', { repository: 'app' }).effect).toBe('allow');
    expect(evaluate(any, bob, 'run.cancel', {}).effect).toBe('deny');
  });

  it('matches a pipeline, and at least one tag; a missing attribute fails', () => {
    const rules = policy(
      [
        rule({
          id: 'p',
          effect: 'allow',
          actions: ['run.cancel'],
          resource: { pipeline: ['feature'] },
        }),
        rule({
          id: 't',
          effect: 'allow',
          actions: ['run.retry'],
          resource: { tags: ['urgent', 'hot'] },
        }),
      ],
      false,
    );
    expect(evaluate(rules, bob, 'run.cancel', { pipeline: 'feature' }).effect).toBe('allow');
    expect(evaluate(rules, bob, 'run.cancel', { pipeline: 'bugfix' }).effect).toBe('deny');
    expect(evaluate(rules, bob, 'run.cancel', {}).effect).toBe('deny');
    expect(evaluate(rules, bob, 'run.retry', { tags: ['x', 'hot'] }).effect).toBe('allow');
    expect(evaluate(rules, bob, 'run.retry', { tags: [] }).effect).toBe('deny');
    expect(evaluate(rules, bob, 'run.retry', {}).effect).toBe('deny');
  });

  it('joins the conditions with “and”', () => {
    const both = policy(
      [
        rule({
          id: 'b',
          effect: 'allow',
          actions: ['run.cancel'],
          resource: { repository: ['app'], author: 'self' },
        }),
      ],
      false,
    );
    expect(evaluate(both, bob, 'run.cancel', { repository: 'app', author: 'bob' }).effect).toBe(
      'allow',
    );
    expect(evaluate(both, bob, 'run.cancel', { repository: 'app', author: 'alice' }).effect).toBe(
      'deny',
    );
    expect(evaluate(both, bob, 'run.cancel', { repository: 'x', author: 'bob' }).effect).toBe(
      'deny',
    );
  });
});

describe('the presets', () => {
  const none = policy([]);
  const user = (role: string[]): Subject => ({ id: 'u', attributes: role.length ? { role } : {} });

  it('give `admin` every action', () => {
    expect(evaluate(none, user(['admin']), 'users.manage', {}).effect).toBe('allow');
    expect(evaluate(none, user(['admin']), 'run.apply', { repository: 'a' }).effect).toBe('allow');
  });

  it('give `developer` the work but not the shared settings', () => {
    const developer = user(['developer']);
    expect(evaluate(none, developer, 'queue.add', { repository: 'a' }).effect).toBe('allow');
    for (const action of [
      'config.global.write',
      'project.add',
      'users.manage',
      'stats.clear',
      'audit.read',
    ]) {
      expect(evaluate(none, developer, action, {}).effect, action).toBe('deny');
    }
  });

  it('give `viewer` the reading only', () => {
    const viewer = user(['viewer']);
    expect(evaluate(none, viewer, 'project.read', { repository: 'a' }).effect).toBe('allow');
    expect(evaluate(none, viewer, 'queue.add', { repository: 'a' }).effect).toBe('deny');
  });

  it('stand for a missing role through the default role', () => {
    expect(evaluate(none, user([]), 'queue.add', {}, 'developer').effect).toBe('allow');
    expect(evaluate(none, user([]), 'config.global.write', {}, 'developer').effect).toBe('deny');
    expect(evaluate(none, user([]), 'queue.add', {}).effect).toBe('deny');
    // a user with a role keeps it
    expect(evaluate(none, user(['viewer']), 'queue.add', {}, 'developer').effect).toBe('deny');
  });

  it('can be switched off', () => {
    expect(evaluate(policy([], false), user(['admin']), 'run.cancel', {}).effect).toBe('deny');
  });
});
