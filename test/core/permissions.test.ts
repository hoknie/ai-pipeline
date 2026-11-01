import { describe, expect, it } from 'vitest';

import {
  commandParts,
  matchesPattern,
  permissionsOf,
  suggestPatterns,
  transition,
  type PermissionsRefresh,
} from '../../src/core/index.ts';

import { config, finish, group, run, runningAttempt, step } from './helpers.ts';

function specialist(state: ReturnType<typeof run>, slug: string) {
  const found = state.run.config.specialists.find((candidate) => candidate.slug === slug);
  if (!found) throw new Error(`no specialist ${slug}`);
  return found;
}

/** Permissions of the test config, with `plan` given extra commands. */
function refreshed(allowCommands: string[]): PermissionsRefresh {
  const refresh = permissionsOf(config());
  if ('error' in refresh) throw new Error(refresh.error);
  const plan = refresh.specialists.plan;
  if (!plan) throw new Error('no plan');
  plan.allowCommands = allowCommands;
  plan.permissions = 'full';
  return { ...refresh, claudeEditMode: 'accept_edits', claudeSettings: 'inherit' };
}

describe('permissions on retry and answer', () => {
  it('takes the permissions of the current config on an answer, and keeps the prompt', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'запустите claude plugin test' });
    transition(
      state,
      {
        kind: 'answer',
        group: 'gruppa-1',
        answer: 'добавил',
        permissions: refreshed(['claude plugin *']),
      },
      2500,
    );
    expect(specialist(state, 'plan')).toMatchObject({
      allowCommands: ['claude plugin *'],
      permissions: 'full',
      prompt: 'План: %s',
    });
    expect(state.run.config.claude.editMode).toBe('accept_edits');
    expect(state.run.config.claude.settings).toBe('inherit');
    step(state);
    expect(runningAttempt(state).stepId).toBe('plan');
  });

  it('keeps the permissions of a specialist missing from the current config', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human');
    const refresh = refreshed(['ls *']);
    if ('error' in refresh) throw new Error(refresh.error);
    delete refresh.specialists.reviewer;
    transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'да', permissions: refresh }, 1);
    expect(specialist(state, 'reviewer').permissions).toBe('read');
    expect(specialist(state, 'plan').allowCommands).toEqual(['ls *']);
  });

  it('retries with the old permissions and a warning when the config is broken', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, 2000);
    expect(group(state).status).toBe('failed');
    transition(
      state,
      { kind: 'retry', group: 'gruppa-1', permissions: { error: 'swarm.max: must be 1-50' } },
      2500,
    );
    expect(group(state).status).toBe('queued');
    expect(group(state).warnings).toContain('permissions not refreshed: swarm.max: must be 1-50');
    expect(specialist(state, 'plan').allowCommands).toEqual([]);
  });

  it('leaves the snapshot alone when the retry is refused', () => {
    const state = run(1);
    step(state);
    expect(() =>
      transition(state, { kind: 'retry', group: 'gruppa-1', permissions: refreshed(['ls *']) }, 1),
    ).toThrow('needs failed, cancelled or conflict');
    expect(specialist(state, 'plan').allowCommands).toEqual([]);
    expect(state.run.config.claude.editMode).toBe('allowlist');
  });

  it('stores the refused calls of an attempt', () => {
    const state = run(1);
    step(state);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: {
          sessionId: null,
          usage: null,
          failure: null,
          outsideChanges: [],
          denials: [{ tool: 'Bash', command: 'python3 fix.py' }],
        },
      },
      2000,
    );
    expect(group(state).attempts[0]?.denials).toEqual([
      { tool: 'Bash', command: 'python3 fix.py' },
    ]);
  });
});

describe('suggested allow_commands patterns', () => {
  const cases: [string, string[], (string | null)[]][] = [
    ['claude plugin test integrations/claude-code', [], ['claude plugin *']],
    ['timeout 120 claude plugin test x', [], ['timeout *']],
    ['cd worktree && npm run check && python3 fix.py', ['npm run check*'], ['python3 *']],
    ['echo "a && b"', [], ['echo *']],
    ['for f in *; do echo $f; done', [], [null]],
    ["cat > /tmp/x.ts <<'EOF'\nconst a = 1;\nEOF", [], [null]],
    ['git -C x status', [], ['git *']],
    ['npm run check 2>&1 | tail -5', ['npm run check*', 'tail *'], []],
    ['ls', ['ls *'], []],
  ];
  it.each(cases)('%s', (command, allow, patterns) => {
    expect(suggestPatterns(command, allow).map((suggestion) => suggestion.pattern)).toEqual(
      patterns,
    );
  });

  it('splits only outside quotes', () => {
    expect(commandParts('grep -n \'a|b\' f; echo "x; y" || true')).toEqual([
      "grep -n 'a|b' f",
      'echo "x; y"',
      'true',
    ]);
  });

  it('matches prefix patterns the way Claude Code does', () => {
    expect(matchesPattern('npm run check -- --watch', 'npm run check*')).toBe(true);
    expect(matchesPattern('npm run build', 'npm run check*')).toBe(false);
    expect(matchesPattern('git status', 'git status')).toBe(true);
  });
});
