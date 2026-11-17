import { describe, expect, it } from 'vitest';

import {
  type FailReason,
  type RunState,
  MESSAGE_GROUP,
  createRun,
  RESOLVE_GROUP,
  deliveryCounts,
} from '../../../src/feature/runs/types/index.ts';
import {
  type Effect,
  dispatch,
  renderCommitMessage,
  transition,
} from '../../../src/feature/runs/machine/index.ts';

import { CONFIG_TEXT, finish, group, run, runningAttempt, step } from './helpers.ts';

function mergedRun(
  groups: number,
  options: { configText?: string; leaveLast?: boolean } = {},
): RunState {
  const state = run(groups, { configText: options.configText });
  state.run.config.delivery.auto = false;
  const done = options.leaveLast ? state.groups.slice(0, -1) : state.groups;
  for (const _ of ['plan', 'code', 'review', 'qa']) {
    step(state);
    for (const group of done)
      finish(state, 'done', { slug: group.slug, summary: `${group.title} done` });
  }
  for (const group of done) {
    transition(
      state,
      {
        kind: 'merge_finished',
        group: group.slug,
        outcome: { kind: 'merged', commit: `c-${group.slug}` },
      },
      5000,
    );
  }
  return state;
}

function request(state: RunState, groups: string[] | null = null, force = false): Effect[] {
  return transition(
    state,
    { kind: 'deliver_requested', groups, force, files: ['src/app.ts'] },
    6000,
  );
}

const applied = { kind: 'applied' as const, files: ['src/app.ts'], conflicts: [], commit: null };

describe('delivery requests', () => {
  it('delivers only merged groups and leaves the rest for later', () => {
    const state = mergedRun(3, { leaveLast: true });
    expect(state.groups.map((group) => group.status)).toEqual(['merged', 'merged', 'running']);
    const effects = request(state);
    expect(effects).toEqual([
      expect.objectContaining({
        kind: 'deliver',
        groups: ['group-1', 'group-2'],
        force: false,
        auto: false,
      }),
    ]);
    transition(state, { kind: 'delivery_finished', result: applied }, 7000);
    expect(deliveryCounts(state)).toEqual({ applied: 2, merged: 2, failed: 0 });
    expect(state.groups[2]?.delivery.state).toBe('pending');
  });

  it('refuses a second delivery of a group, unmerged groups and a delivery in progress', () => {
    const state = mergedRun(3, { leaveLast: true });
    request(state, ['group-1']);
    expect(() => request(state, ['group-2'])).toThrow('already in progress');
    transition(state, { kind: 'delivery_finished', result: applied }, 7000);
    expect(() => request(state, ['group-1'])).toThrow('already delivered');
    expect(() => request(state, ['group-3'])).toThrow('only merged groups can be delivered');
    expect(() => request(state, ['nope'])).toThrow('unknown group');
  });

  it('marks refused deliveries as apply_failed and lets them be delivered again', () => {
    const state = mergedRun(1);
    request(state);
    transition(
      state,
      {
        kind: 'delivery_finished',
        result: { kind: 'refused', reason: 'conflict', files: ['a.ts'] },
      },
      7000,
    );
    expect(state.groups[0]?.delivery).toEqual({
      state: 'apply_failed',
      reason: 'conflict',
      files: ['a.ts'],
      conflicts: [],
      userEdits: [],
      manual: false,
      finishedAt: 7000,
    });
    expect(deliveryCounts(state).failed).toBe(1);
    expect(request(state, null, true)).toEqual([
      expect.objectContaining({ kind: 'deliver', force: true }),
    ]);
  });

  it('records when each delivery attempt ended, also a repeated refusal with the same reason', () => {
    const state = mergedRun(1);
    expect(state.groups[0]?.delivery.finishedAt).toBeNull();
    const refused = { kind: 'refused' as const, reason: 'same', files: [] };
    request(state);
    transition(state, { kind: 'delivery_finished', result: refused }, 7000);
    expect(state.groups[0]?.delivery.finishedAt).toBe(7000);
    request(state);
    transition(state, { kind: 'delivery_finished', result: refused }, 9000);
    expect(state.groups[0]?.delivery).toMatchObject({
      state: 'apply_failed',
      reason: 'same',
      finishedAt: 9000,
    });
    request(state);
    transition(state, { kind: 'delivery_finished', result: applied }, 9500);
    expect(state.groups[0]?.delivery.finishedAt).toBe(9500);
  });

  it('keeps the time of the last attempt when a delivery is interrupted', () => {
    const state = mergedRun(1);
    request(state);
    transition(
      state,
      { kind: 'delivery_finished', result: { kind: 'failed', message: 'x' } },
      7000,
    );
    request(state);
    transition(state, { kind: 'interrupted' }, 8000);
    expect(state.groups[0]?.delivery.finishedAt).toBe(7000);
  });

  it('points runs from before hidden refs to git merge', () => {
    const state = mergedRun(1);
    state.run.refStyle = 'branches';
    state.run.branch = 'aip/old';
    expect(() => request(state)).toThrow('git merge aip/old');
  });

  it('cleans up once every merged group of a finished run is delivered, unless keep is set', () => {
    const state = mergedRun(1);
    request(state);
    expect(transition(state, { kind: 'delivery_finished', result: applied }, 7000)).toEqual([
      { kind: 'cleanup', run: state.run.id },
    ]);
    const kept = mergedRun(1);
    kept.run.config.delivery.keep = true;
    request(kept);
    expect(transition(kept, { kind: 'delivery_finished', result: applied }, 7000)).toEqual([]);
  });

  it('does not clean up while other groups still work', () => {
    const state = mergedRun(2, { leaveLast: true });
    request(state);
    expect(transition(state, { kind: 'delivery_finished', result: applied }, 7000)).toEqual([]);
  });
});

describe('manual delivery mark', () => {
  const mark = (state: RunState, groups: string[] | null = null): Effect[] =>
    transition(state, { kind: 'delivered_marked', groups }, 8000);

  it('marks groups with a failed delivery and cleans up', () => {
    const state = mergedRun(1);
    request(state);
    transition(
      state,
      { kind: 'delivery_finished', result: { kind: 'refused', reason: 'x', files: ['a.ts'] } },
      7000,
    );
    expect(mark(state)).toEqual([{ kind: 'cleanup', run: state.run.id }]);
    expect(state.groups[0]?.delivery).toEqual({
      state: 'applied',
      reason: null,
      files: [],
      conflicts: [],
      userEdits: [],
      manual: true,
      finishedAt: 8000,
    });
  });

  it('marks groups waiting in pending and a chosen part of them', () => {
    const state = mergedRun(2);
    expect(mark(state, ['group-1'])).toEqual([]);
    expect(state.groups.map((group) => group.delivery.state)).toEqual(['applied', 'pending']);
    expect(mark(state)).toEqual([{ kind: 'cleanup', run: state.run.id }]);
    expect(state.groups.every((group) => group.delivery.manual)).toBe(true);
  });

  it('does not clean up with keep, or while other groups still work', () => {
    const kept = mergedRun(1);
    kept.run.config.delivery.keep = true;
    expect(mark(kept)).toEqual([]);
    expect(kept.groups[0]?.delivery.state).toBe('applied');
    const working = mergedRun(3, { leaveLast: true });
    expect(mark(working)).toEqual([]);
    expect(working.groups[0]?.delivery.manual).toBe(true);
    expect(working.groups[2]?.delivery.state).toBe('pending');
  });

  it('marks a run that keeps its result in a branch', () => {
    const state = mergedRun(1);
    state.run.refStyle = 'branches';
    mark(state);
    expect(state.groups[0]?.delivery.state).toBe('applied');
  });

  it('refuses without changing anything', () => {
    const state = mergedRun(3, { leaveLast: true });
    request(state, ['group-1']);
    expect(() => mark(state)).toThrow('already in progress');
    transition(state, { kind: 'delivery_finished', result: applied }, 7000);
    expect(() => mark(state, ['group-1'])).toThrow('already delivered');
    expect(() => mark(state, ['group-3'])).toThrow('only merged groups can be marked delivered');
    expect(() => mark(state, ['nope'])).toThrow('unknown group');
    expect(() => mark(state, ['group-2', 'group-1'])).toThrow('already delivered');
    expect(state.groups[1]?.delivery.state).toBe('pending');
    expect(state.groups[0]?.delivery.manual).toBe(false);
    expect(() => mark(run(1))).toThrow('nothing to mark: no merged groups are waiting');
  });
});

describe('commit messages', () => {
  it('uses the group title and summaries by default', () => {
    const state = mergedRun(1);
    expect(renderCommitMessage('{title}\n\n{groups}', state, state.groups)).toBe(
      'Group 1\n\n- Group 1: Group 1 done',
    );
  });

  it('fills every placeholder', () => {
    const state = mergedRun(2);
    expect(renderCommitMessage('[{run}/{pipeline}] {title}\n{task}', state, state.groups)).toBe(
      `[${state.run.id}/feature] 2 groups: Group 1, Group 2\ntask 1\n\ntask 2`,
    );
  });

  it('still fills the old {workflow} placeholder with the pipeline', () => {
    const state = mergedRun(1);
    expect(renderCommitMessage('[{workflow}] {title}', state, state.groups)).toBe(
      `[${state.run.pipeline}] Group 1`,
    );
  });

  it('fills the task number', () => {
    const state = mergedRun(1);
    expect(renderCommitMessage('feat(AIP-{number}): {title}', state, state.groups)).toBe(
      `feat(AIP-${state.run.number}): Group 1`,
    );
  });

  const WRITER =
    CONFIG_TEXT.replace(
      '    qa: { name: Tester }',
      '    qa: { name: Tester }\n    writer: { name: Author }',
    ) + '  delivery: { mode: commit, message_specialist: writer }\n';

  it('asks the message specialist and uses its summary', () => {
    const state = mergedRun(1, { configText: WRITER });
    expect(request(state)).toEqual([]);
    expect(state.message?.task).toContain('src/app.ts');
    expect(state.message?.task).toContain(`Task number: ${state.run.number}`);
    dispatch([state], 6100);
    expect(runningAttempt(state, MESSAGE_GROUP)).toMatchObject({
      stepId: 'message',
      specialist: 'writer',
    });
    const effects = finish(state, 'done', {
      slug: MESSAGE_GROUP,
      summary: 'feat: login\n\ndetails',
    });
    expect(effects).toEqual([
      expect.objectContaining({ kind: 'deliver', message: 'feat: login\n\ndetails' }),
    ]);
  });

  it('falls back to the template when the message specialist fails', () => {
    const state = mergedRun(1, { configText: WRITER });
    request(state);
    dispatch([state], 6100);
    const effects = transition(state, { kind: 'timed_out', group: MESSAGE_GROUP, seq: 1 }, 6200);
    expect(effects).toContainEqual(
      expect.objectContaining({
        kind: 'deliver',
        message: 'Group 1\n\n- Group 1: Group 1 done',
      }),
    );
  });

  describe('the text answer of the message specialist without a report', () => {
    const WRITER_CHAIN =
      CONFIG_TEXT.replace(
        '  specialists:\n',
        `  chains:
    fallback:
      name: Fallback
      mode: on_error
      runtimes:
        - { runtime: claude, model: haiku }
        - { runtime: claude, model: sonnet }
  specialists:
`,
      ).replace(
        '    qa: { name: Tester }',
        '    qa: { name: Tester }\n    writer: { name: Author, runtime_chain: fallback }',
      ) + '  delivery: { mode: commit, message_specialist: writer }\n';

    function exit(
      state: RunState,
      slug: string,
      reply: string | null,
      failure: FailReason | null = null,
    ): Effect[] {
      const attempt = runningAttempt(state, slug);
      return transition(
        state,
        {
          kind: 'attempt_exited',
          group: slug,
          seq: attempt.seq,
          exit: { sessionId: 's', usage: null, failure, outsideChanges: [], reply },
        },
        6200,
      );
    }

    function messageRun(configText: string): RunState {
      const state = mergedRun(1, { configText });
      request(state);
      dispatch([state], 6100);
      return state;
    }

    it('takes the text as the message and marks the report', () => {
      const state = messageRun(WRITER);
      const effects = exit(state, MESSAGE_GROUP, '\nfix(AIP-422): add back button\n');
      expect(effects).toEqual([
        expect.objectContaining({ kind: 'deliver', message: 'fix(AIP-422): add back button' }),
      ]);
      const message = state.message!;
      expect(message.status).toBe('merged');
      expect(message.attempts[0]).toMatchObject({
        status: 'finished',
        reason: null,
        report: { verdict: 'done', summary: 'fix(AIP-422): add back button', source: 'reply' },
      });
    });

    it('takes the text before the next item of the chain', () => {
      const state = messageRun(WRITER_CHAIN);
      expect(runningAttempt(state, MESSAGE_GROUP).model).toBe('haiku');
      const effects = exit(state, MESSAGE_GROUP, 'feat: login');
      expect(effects).toContainEqual(
        expect.objectContaining({ kind: 'deliver', message: 'feat: login' }),
      );
      expect(state.message!.attempts).toHaveLength(1);
    });

    it('falls back to the template without text and without another item', () => {
      const state = messageRun(WRITER);
      const effects = exit(state, MESSAGE_GROUP, '  ');
      expect(effects).toContainEqual(
        expect.objectContaining({ kind: 'deliver', message: 'Group 1\n\n- Group 1: Group 1 done' }),
      );
      expect(state.message!.attempts[0]).toMatchObject({ reason: { kind: 'no_report' } });
    });

    it('falls back to the template when the attempt failed, text or not', () => {
      const state = messageRun(WRITER);
      const effects = exit(state, MESSAGE_GROUP, 'feat: login', { kind: 'timeout' });
      expect(effects).toContainEqual(
        expect.objectContaining({ kind: 'deliver', message: 'Group 1\n\n- Group 1: Group 1 done' }),
      );
    });

    it('does not take the text of an ordinary step', () => {
      const state = run(1);
      step(state);
      exit(state, 'group-1', 'the plan is done');
      expect(group(state).attempts[0]).toMatchObject({
        status: 'failed',
        reason: { kind: 'no_report' },
        report: null,
      });
    });
  });
});

describe('automatic delivery of one run', () => {
  function finishAndMerge(state: RunState): Effect[] {
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      finish(state, 'done');
    }
    return transition(
      state,
      { kind: 'merge_finished', group: 'group-1', outcome: { kind: 'merged', commit: 'c' } },
      5000,
    );
  }

  it('does not deliver a run with autoDeliver false although delivery.auto is on', () => {
    const state = run(1, { autoDeliver: false });
    expect(state.run.config.delivery.auto).toBe(false);
    expect(finishAndMerge(state)).toEqual([]);
    expect(state.groups[0]?.delivery.state).toBe('pending');
  });

  it('takes the delivery mode of the run over the configuration', () => {
    expect(run(1, { deliveryMode: 'commit' }).run.config.delivery.mode).toBe('commit');
    expect(run(1, { deliveryMode: 'branch' }).run.config.delivery.mode).toBe('branch');
    expect(run(1).run.config.delivery.mode).toBe('worktree');
  });

  it('delivers a run with autoDeliver true although delivery.auto is off', () => {
    const state = run(1, { configText: undefined });
    const source = run(1);
    source.run.config.delivery.auto = false;
    const overridden = createRun({
      id: 'run000000002',
      number: 1,
      repository: '/repo',
      pipeline: 'feature',
      baseCommit: 'abc',
      config: source.run.config,
      dirtyWarning: false,
      groups: [{ title: 'Group 1', task: 'task 1' }],
      split: false,
      now: 1000,
      autoDeliver: true,
    });
    expect(state.run.config.delivery.auto).toBe(true);
    expect(overridden.run.config.delivery.auto).toBe(true);
    expect(source.run.config.delivery.auto).toBe(false);
    expect(finishAndMerge(overridden)).toEqual([
      expect.objectContaining({ kind: 'deliver', auto: true, groups: ['group-1'] }),
    ]);
  });

  it('keeps the configuration object of the caller untouched', () => {
    const base = run(1);
    const copy = createRun({
      id: 'run000000003',
      number: 1,
      repository: '/repo',
      pipeline: 'feature',
      baseCommit: 'abc',
      config: base.run.config,
      dirtyWarning: false,
      groups: [{ title: 'a', task: 'b' }],
      split: false,
      now: 1,
      autoDeliver: false,
    });
    expect(base.run.config.delivery.auto).toBe(true);
    expect(copy.run.config.delivery.auto).toBe(false);
  });
});

describe('automatic delivery', () => {
  it('requests delivery as soon as the run finishes when delivery.auto is on', () => {
    const state = run(1);
    state.run.config.delivery.auto = true;
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      finish(state, 'done');
    }
    const effects = transition(
      state,
      { kind: 'merge_finished', group: 'group-1', outcome: { kind: 'merged', commit: 'c' } },
      5000,
    );
    expect(effects).toEqual([
      expect.objectContaining({ kind: 'deliver', auto: true, groups: ['group-1'] }),
    ]);
    transition(
      state,
      { kind: 'delivery_finished', result: { kind: 'refused', reason: 'dirty', files: ['x'] } },
      6000,
    );
    expect(state.groups[0]?.delivery.state).toBe('apply_failed');
    expect(request(state)).toEqual([expect.objectContaining({ kind: 'deliver', auto: false })]);
  });

  it('turns off with auto_delivery_cancelled: no effects, and the finish delivers nothing', () => {
    const state = run(1);
    state.run.config.delivery.auto = true;
    expect(transition(state, { kind: 'auto_delivery_cancelled' }, 100)).toEqual([]);
    expect(state.run.config.delivery.auto).toBe(false);
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      finish(state, 'done');
    }
    expect(
      transition(
        state,
        { kind: 'merge_finished', group: 'group-1', outcome: { kind: 'merged', commit: 'c' } },
        5000,
      ),
    ).toEqual([]);
    expect(state.run.finishedAt).toBe(5000);
    expect(state.groups[0]?.delivery.state).toBe('pending');
  });

  it('rejects the cancellation for a finished run and when auto is already off', () => {
    const off = run(1);
    off.run.config.delivery.auto = false;
    expect(() => transition(off, { kind: 'auto_delivery_cancelled' }, 100)).toThrow(/is off/);

    const finished = run(1);
    finished.run.config.delivery.auto = true;
    transition(finished, { kind: 'cancel', group: null }, 10);
    expect(finished.run.finishedAt).not.toBeNull();
    expect(() => transition(finished, { kind: 'auto_delivery_cancelled' }, 100)).toThrow(
      /is finished/,
    );
    expect(finished.run.config.delivery.auto).toBe(true);
  });

  it('does nothing when delivery.auto is off', () => {
    const state = run(1);
    state.run.config.delivery.auto = false;
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      finish(state, 'done');
    }
    expect(
      transition(
        state,
        { kind: 'merge_finished', group: 'group-1', outcome: { kind: 'merged', commit: 'c' } },
        5000,
      ),
    ).toEqual([]);
  });
});

describe('delivery resolver', () => {
  const RESOLVER = (rounds: number) =>
    `${CONFIG_TEXT}  delivery: { resolver: coder, resolver_rounds: ${rounds} }\n`;
  const conflict = {
    kind: 'refused' as const,
    reason: 'the changes conflict with your working tree',
    files: ['src/app.ts'],
    conflict: true,
  };

  function refusedWithResolver(rounds: number): RunState {
    const state = mergedRun(1, { configText: RESOLVER(rounds) });
    request(state);
    const effects = transition(state, { kind: 'delivery_finished', result: conflict }, 6100);
    expect(effects).toEqual([
      { kind: 'prepare_resolve', run: state.run.id, groups: ['group-1'], round: 1 },
    ]);
    expect(state.run.pendingDelivery).not.toBeNull();
    expect(
      transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 6200),
    ).toEqual([]);
    dispatch([state], 6300);
    return state;
  }

  it('hands a conflict to the resolver and delivers its result', () => {
    const state = refusedWithResolver(1);
    expect(runningAttempt(state, RESOLVE_GROUP)).toMatchObject({
      stepId: 'resolve',
      specialist: 'coder',
    });
    expect(state.resolve?.task).toContain('- src/app.ts');
    expect(state.resolve?.task).toContain('Run the checks in the foreground');
    const effects = finish(state, 'done', { slug: RESOLVE_GROUP, now: 6400 });
    expect(effects).toEqual([
      {
        kind: 'finish_resolve',
        run: state.run.id,
        groups: ['group-1'],
        message: 'Group 1\n\n- Group 1: Group 1 done',
        conflicts: ['src/app.ts'],
      },
    ]);
    transition(state, { kind: 'delivery_finished', result: applied }, 6500);
    expect(state.groups[0]?.delivery.state).toBe('applied');
    expect(state.run.pendingDelivery).toBeNull();
  });

  it('starts another round until resolver_rounds is used up, then marks apply_failed', () => {
    const state = refusedWithResolver(2);
    const second = finish(state, 'rejected', {
      slug: RESOLVE_GROUP,
      feedback: 'cannot',
      now: 6400,
    });
    expect(second).toEqual([
      { kind: 'prepare_resolve', run: state.run.id, groups: ['group-1'], round: 2 },
    ]);
    transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 6500);
    expect(state.resolve?.status).toBe('queued');
    dispatch([state], 6600);
    finish(state, 'done', { slug: RESOLVE_GROUP, now: 6700 });
    const final = transition(
      state,
      { kind: 'delivery_finished', result: { ...conflict, reason: 'again' } },
      6800,
    );
    expect(final).toEqual([]);
    expect(state.groups[0]?.delivery).toMatchObject({
      state: 'apply_failed',
      reason: 'again',
      files: ['src/app.ts'],
    });
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.resolve?.attempts).toHaveLength(2);
  });

  it('marks apply_failed with the reason of a failed resolver', () => {
    const state = refusedWithResolver(1);
    transition(state, { kind: 'timed_out', group: RESOLVE_GROUP, seq: 1 }, 6400);
    expect(state.groups[0]?.delivery).toMatchObject({
      state: 'apply_failed',
      reason: 'the resolver failed: timeout',
      files: ['src/app.ts'],
    });
  });

  it('does not resolve forced deliveries or refusals that are not conflicts', () => {
    const forced = mergedRun(1, { configText: RESOLVER(1) });
    request(forced, null, true);
    expect(transition(forced, { kind: 'delivery_finished', result: conflict }, 6100)).toEqual([]);
    expect(forced.groups[0]?.delivery.state).toBe('apply_failed');
    const staged = mergedRun(1, { configText: RESOLVER(1) });
    request(staged);
    const result = { kind: 'refused' as const, reason: 'staged', files: [] };
    expect(transition(staged, { kind: 'delivery_finished', result }, 6100)).toEqual([]);
    expect(staged.resolve).toBeNull();
  });

  it('delivers without a resolver step when the prepared tree has no conflicts left', () => {
    const state = mergedRun(1, { configText: RESOLVER(1) });
    request(state);
    transition(state, { kind: 'delivery_finished', result: conflict }, 6100);
    expect(transition(state, { kind: 'resolve_prepared', conflicts: [] }, 6200)).toEqual([
      expect.objectContaining({ kind: 'finish_resolve', conflicts: [] }),
    ]);
    expect(state.resolve).toBeNull();
  });
});

describe('delivery after a daemon restart', () => {
  const interrupt = (state: RunState): Effect[] => transition(state, { kind: 'interrupted' }, 9000);

  it('starts again a delivery whose git work was cut off', () => {
    const state = mergedRun(2);
    request(state, ['group-1'], true);
    expect(interrupt(state)).toEqual([
      expect.objectContaining({ kind: 'deliver', groups: ['group-1'], force: true, auto: false }),
    ]);
    expect(state.run.pendingDelivery).toMatchObject({ groups: ['group-1'], force: true });
    transition(state, { kind: 'delivery_finished', result: applied }, 9100);
    expect(state.groups.map((group) => group.delivery.state)).toEqual(['applied', 'pending']);
  });

  it('asks the message specialist again when it was cut off', () => {
    const WRITER =
      CONFIG_TEXT.replace(
        '    qa: { name: Tester }',
        '    qa: { name: Tester }\n    writer: { name: Author }',
      ) + '  delivery: { mode: commit, message_specialist: writer }\n';
    const state = mergedRun(1, { configText: WRITER });
    request(state);
    dispatch([state], 6100);
    expect(interrupt(state)).toEqual([]);
    expect(state.message?.status).toBe('queued');
    expect(state.run.finishedAt).toBeNull();
    dispatch([state], 9100);
    expect(runningAttempt(state, MESSAGE_GROUP)).toMatchObject({ specialist: 'writer' });
  });

  it('starts a delivery cut off in the resolver from the first round', () => {
    const state = mergedRun(1, {
      configText: `${CONFIG_TEXT}  delivery: { resolver: coder, resolver_rounds: 1 }\n`,
    });
    request(state);
    transition(
      state,
      {
        kind: 'delivery_finished',
        result: { kind: 'refused', reason: 'conflict', files: ['src/app.ts'], conflict: true },
      },
      6100,
    );
    transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 6200);
    dispatch([state], 6300);
    expect(interrupt(state)).toEqual([
      expect.objectContaining({ kind: 'deliver', groups: ['group-1'] }),
    ]);
    expect(state.resolve?.status).toBe('failed');
    expect(state.run.pendingDelivery).toEqual(
      expect.not.objectContaining({ round: expect.anything() }),
    );
    expect(state.groups[0]?.delivery.state).toBe('pending');
  });

  it('does nothing for a run without a delivery in progress', () => {
    const state = mergedRun(1);
    expect(interrupt(state)).toEqual([]);
    expect(state.run.pendingDelivery).toBeNull();
  });
});
