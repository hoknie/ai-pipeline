import { describe, expect, it } from 'vitest';

import {
  type RunState,
  allGroups,
  createRun,
  findGroup,
  isRunFinished,
  isServiceGroup,
  nextAction,
  pipelineStages,
  runPhase,
  runStages,
  runPipeline,
} from '../../../src/feature/runs/types/index.ts';
import {
  type Effect,
  dispatch,
  planDispatch,
  transition,
} from '../../../src/feature/runs/machine/index.ts';

import { config, finish, runningAttempt } from './helpers.ts';

function configText(extra: string, pipeline = ''): string {
  return `swarm:
  max: 2
  specialists:
    coder: { name: Кодировщик }
    writer: { name: Писатель }
    fixer: { name: Фиксер }
${extra}
  pipelines:
    feature:
${pipeline || '      steps:\n        - { id: code, specialist: coder }'}
`;
}

const SPLIT_PIPELINE = `      split: { specialist: coder, max_groups: 3 }
      steps:
        - { id: code, specialist: coder }`;

function start(
  text: string,
  options: { groups?: number; split?: boolean; autoDeliver?: boolean } = {},
): RunState {
  const count = options.groups ?? 1;
  return createRun({
    id: 'run000000001',
    number: 1,
    repository: '/repo',
    pipeline: 'feature',
    baseCommit: 'abc',
    config: config(text),
    dirtyWarning: false,
    groups: Array.from({ length: count }, (_, index) => ({
      title: `Группа ${index + 1}`,
      task: `задача ${index + 1}`,
    })),
    split: options.split ?? false,
    now: 1000,
    autoDeliver: options.autoDeliver ?? false,
  });
}

function kinds(effects: Effect[]): string[] {
  return effects.map((effect) => effect.kind);
}

/** Ends the running command of an action. */
function commandExit(state: RunState, slug: string, code: number, now = 3000): Effect[] {
  const attempt = runningAttempt(state, slug);
  return transition(
    state,
    { kind: 'action_finished', group: slug, seq: attempt.seq, outcome: { kind: 'exit', code } },
    now,
  );
}

function lastOf(state: RunState, slug: string) {
  const found = findGroup(state, slug);
  if (!found) throw new Error(`no group ${slug}`);
  return found;
}

/** The first group of work finishes its single step. */
function finishWork(state: RunState, slug = 'gruppa-1'): Effect[] {
  dispatch([state], 1500);
  const effects = finish(state, 'done', { slug });
  // A merge: the daemon would do it; the test reports it done.
  const merging = allGroups(state).filter((group) => group.status === 'merging');
  for (const group of merging) {
    transition(
      state,
      { kind: 'merge_finished', group: group.slug, outcome: { kind: 'merged', commit: 'm1' } },
      2500,
    );
  }
  return effects;
}

const AFTER_DELIVERY = `  actions:
    commit: { run: "git commit -am x" }
  stages:
    after_delivery: [commit]`;

describe('creation of a run with actions', () => {
  it('has no action groups without actions', () => {
    const state = start(configText(''), { split: true });
    expect(state.actions).toEqual([]);
  });

  it('queues the actions before the split from the start and holds the split', () => {
    const state = start(
      configText(
        `  actions:
    prepare: { run: "echo 1" }
    plan: { run: "echo 2" }
  stages:
    before_split: [prepare, plan]`,
        SPLIT_PIPELINE,
      ),
      { split: true },
    );
    expect(state.actions.map((group) => group.slug)).toEqual([
      '_action-before-split-prepare',
      '_action-before-split-plan',
    ]);
    expect(state.actions.every(isServiceGroup)).toBe(true);
    // Only the first action starts; the split and the second action wait.
    const effects = dispatch([state], 1500);
    expect(effects).toEqual([
      { kind: 'run_action', run: 'run000000001', group: '_action-before-split-prepare', seq: 1 },
    ]);
    expect(lastOf(state, '_action-before-split-prepare').status).toBe('running');
    expect(state.split?.status).toBe('queued');
  });

  it('starts the second action only after the first one succeeded', () => {
    const state = start(
      configText(
        `  actions:
    lint: { run: "a" }
    check: { run: "b" }
  stages:
    before_split: [lint, check]`,
        SPLIT_PIPELINE,
      ),
      { split: true },
    );
    dispatch([state], 1500);
    expect(dispatch([state], 1600)).toEqual([]);
    commandExit(state, '_action-before-split-lint', 0);
    expect(kinds(dispatch([state], 3500))).toEqual(['run_action']);
    expect(lastOf(state, '_action-before-split-check').status).toBe('running');
    expect(state.split?.status).toBe('queued');
    commandExit(state, '_action-before-split-check', 0, 4000);
    expect(dispatch([state], 4500)).toEqual([
      { kind: 'start_attempt', run: 'run000000001', group: '_split', seq: 1 },
    ]);
  });

  it('skips the points around the split in a pipeline without a split', () => {
    const state = start(
      configText(`  actions:
    prepare: { run: "a" }
  stages:
    before_split: [prepare]
    after_split: [prepare]`),
    );
    expect(state.actions).toEqual([]);
  });

  it('does not enter the points when the groups are given and not split', () => {
    const state = start(
      configText(
        `  actions:
    prepare: { run: "a" }
  stages:
    before_split: [prepare]`,
        SPLIT_PIPELINE,
      ),
      { split: false },
    );
    expect(state.split).toBeNull();
    expect(state.actions).toEqual([]);
  });
});

describe('a command action', () => {
  const BEFORE = configText(
    `  actions:
    prepare: { run: "a" }
  stages:
    before_split: [prepare]`,
    SPLIT_PIPELINE,
  );

  it('does not use the places of swarm.max or a specialist', () => {
    const state = start(BEFORE.replace('max: 2', 'max: 1'), { split: true });
    const plan = planDispatch([state], 1500);
    expect(plan.start.map((entry) => entry.group.slug)).toEqual(['_action-before-split-prepare']);
    dispatch([state], 1500);
    // A running command does not count against the places: another run could still start.
    const other = start(BEFORE.replace('max: 2', 'max: 1'), { split: false });
    other.run.id = 'run000000002';
    other.run.createdAt = 2000;
    other.run.config.max = 1;
    expect(planDispatch([state, other], 1600).start.map((entry) => entry.group.slug)).toEqual([
      'gruppa-1',
    ]);
  });

  it('records a successful exit as a done step', () => {
    const state = start(BEFORE, { split: true });
    dispatch([state], 1500);
    commandExit(state, '_action-before-split-prepare', 0);
    const group = lastOf(state, '_action-before-split-prepare');
    expect(group.status).toBe('merged');
    expect(group.attempts[0]).toMatchObject({
      runtime: 'command',
      specialist: 'prepare',
      status: 'finished',
    });
    expect(nextAction(state, 'before_split')).toEqual({ kind: 'closed' });
  });

  it('asks the daemon to commit the changes of an action before the split', () => {
    const state = start(BEFORE, { split: true });
    dispatch([state], 1500);
    const effects = commandExit(state, '_action-before-split-prepare', 0);
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'commit', group: '_action-before-split-prepare' }),
    );
  });

  it('fails with the exit code, the timeout and a spawn error', () => {
    for (const [outcome, reason] of [
      [{ kind: 'exit', code: 7 }, 'exit code 7'],
      [{ kind: 'timeout' }, 'timeout'],
      [{ kind: 'spawn', message: 'no sh' }, 'spawn error: no sh'],
    ] as const) {
      const state = start(BEFORE, { split: true });
      dispatch([state], 1500);
      const attempt = runningAttempt(state, '_action-before-split-prepare');
      transition(
        state,
        {
          kind: 'action_finished',
          group: '_action-before-split-prepare',
          seq: attempt.seq,
          outcome,
        },
        3000,
      );
      const group = lastOf(state, '_action-before-split-prepare');
      expect(group.status).toBe('failed');
      expect(group.reason).toBe(reason);
      expect(group.attempts[0]?.status).toBe('failed');
    }
  });

  it('ignores the end of a cancelled command', () => {
    const state = start(BEFORE, { split: true });
    dispatch([state], 1500);
    const attempt = runningAttempt(state, '_action-before-split-prepare');
    transition(state, { kind: 'cancel', group: '_action-before-split-prepare' }, 2000);
    const effects = transition(
      state,
      {
        kind: 'action_finished',
        group: '_action-before-split-prepare',
        seq: attempt.seq,
        outcome: { kind: 'exit', code: 0 },
      },
      3000,
    );
    expect(effects).toEqual([]);
    expect(lastOf(state, '_action-before-split-prepare').status).toBe('cancelled');
  });
});

describe('failure of an action before the split', () => {
  const TEXT = configText(
    `  actions:
    prepare: { run: "a" }
  stages:
    before_split: [prepare]`,
    SPLIT_PIPELINE,
  );

  it('stops the run at the action; a retry that succeeds lets the split start', () => {
    const state = start(TEXT, { split: true });
    dispatch([state], 1500);
    commandExit(state, '_action-before-split-prepare', 1);
    expect(isRunFinished(state)).toBe(true);
    expect(runPhase(state)).toBe('failed');
    expect(dispatch([state], 3500)).toEqual([]);
    transition(state, { kind: 'retry', group: '_action-before-split-prepare' }, 4000);
    expect(isRunFinished(state)).toBe(false);
    expect(kinds(dispatch([state], 4500))).toEqual(['run_action']);
    commandExit(state, '_action-before-split-prepare', 0, 5000);
    expect(kinds(dispatch([state], 5500))).toEqual(['start_attempt']);
    expect(state.split?.status).toBe('running');
  });

  it('goes on when the failure is allowed', () => {
    const state = start(TEXT.replace('run: "a"', 'run: "a", on_failure: continue'), {
      split: true,
    });
    dispatch([state], 1500);
    commandExit(state, '_action-before-split-prepare', 1);
    expect(lastOf(state, '_action-before-split-prepare').status).toBe('failed');
    expect(kinds(dispatch([state], 3500))).toEqual(['start_attempt']);
    expect(runPhase(state)).toBe('active');
  });

  it('stops the run when the action is cancelled and lets a retry continue', () => {
    const state = start(TEXT, { split: true });
    dispatch([state], 1500);
    transition(state, { kind: 'cancel', group: '_action-before-split-prepare' }, 2000);
    expect(runPhase(state)).toBe('cancelled');
    expect(dispatch([state], 2500)).toEqual([]);
    transition(state, { kind: 'retry', group: '_action-before-split-prepare' }, 3000);
    expect(kinds(dispatch([state], 3500))).toEqual(['run_action']);
  });

  it('does not run while the run is held, but delivery points do', () => {
    const state = start(TEXT, { split: true });
    transition(state, { kind: 'hold', hold: 'paused' }, 1200);
    expect(dispatch([state], 1500)).toEqual([]);
    transition(state, { kind: 'hold', hold: null }, 1600);
    expect(kinds(dispatch([state], 1700))).toEqual(['run_action']);
  });
});

describe('actions after the split', () => {
  const TEXT = configText(
    `  actions:
    prepare: { run: "a" }
  stages:
    after_split: [prepare]`,
    SPLIT_PIPELINE,
  );

  function proposed(): RunState {
    const state = start(TEXT, { split: true });
    dispatch([state], 1500);
    const attempt = runningAttempt(state, '_split');
    transition(
      state,
      {
        kind: 'split_proposed',
        seq: attempt.seq,
        groups: [
          { title: 'Первая', task: 'один' },
          { title: 'Вторая', task: 'два' },
        ],
      },
      2000,
    );
    finish(state, 'done', { slug: '_split' });
    return state;
  }

  it('queues the new groups and starts only the action', () => {
    const state = proposed();
    expect(state.groups.map((group) => group.status)).toEqual(['queued', 'queued']);
    expect(state.actions.map((group) => group.slug)).toEqual(['_action-after-split-prepare']);
    expect(dispatch([state], 2500)).toEqual([
      { kind: 'run_action', run: 'run000000001', group: '_action-after-split-prepare', seq: 1 },
    ]);
    expect(isRunFinished(state)).toBe(false);
  });

  it('starts the groups once the action is done', () => {
    const state = proposed();
    dispatch([state], 2500);
    commandExit(state, '_action-after-split-prepare', 0);
    expect(kinds(dispatch([state], 3500))).toEqual(['start_attempt', 'start_attempt']);
  });

  it('keeps the groups back after a failure and is finished for the scheduler', () => {
    const state = proposed();
    dispatch([state], 2500);
    commandExit(state, '_action-after-split-prepare', 2);
    expect(dispatch([state], 3500)).toEqual([]);
    expect(isRunFinished(state)).toBe(true);
    expect(state.groups.map((group) => group.status)).toEqual(['queued', 'queued']);
  });
});

describe('actions before delivery', () => {
  const TEXT = configText(`  actions:
    lint: { run: "a" }
    check: { run: "b" }
  stages:
    before_delivery: [lint, check]`);

  function merged(): RunState {
    const state = start(TEXT);
    finishWork(state);
    return state;
  }

  it('hold the delivery request until they are done, then deliver', () => {
    const state = merged();
    const requested = transition(
      state,
      { kind: 'deliver_requested', groups: null, force: false, files: [] },
      3000,
    );
    expect(requested).toEqual([]);
    expect(state.run.pendingDelivery).toMatchObject({ checks: true });
    expect(kinds(dispatch([state], 3100))).toEqual(['run_action']);
    expect(commandExit(state, '_action-before-delivery-lint', 0, 3200)).toEqual([]);
    dispatch([state], 3300);
    const effects = commandExit(state, '_action-before-delivery-check', 0, 3400);
    expect(effects).toEqual([
      expect.objectContaining({ kind: 'deliver', groups: ['gruppa-1'], force: false }),
    ]);
    expect(state.run.pendingDelivery?.checks).toBe(false);
  });

  it('cancel the delivery when an action fails, and run again at the next request', () => {
    const state = merged();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    dispatch([state], 3100);
    const effects = commandExit(state, '_action-before-delivery-lint', 1, 3200);
    expect(effects).toEqual([]);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.groups[0]?.delivery.state).toBe('pending');
    expect(dispatch([state], 3300)).toEqual([]);
    expect(runPhase(state)).toBe('failed');
    // The next request starts the checks again from the first one.
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 4000);
    expect(state.actions.map((group) => group.status)).toEqual(['queued', 'queued']);
    expect(dispatch([state], 4100)).toEqual([
      { kind: 'run_action', run: 'run000000001', group: '_action-before-delivery-lint', seq: 2 },
    ]);
  });

  it('refuse a new request while the checks run', () => {
    const state = merged();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    expect(() =>
      transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3100),
    ).toThrow(/already in progress/);
  });

  it('go on after an allowed failure', () => {
    const state = start(TEXT.replace('run: "a"', 'run: "a", on_failure: continue'));
    finishWork(state);
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    dispatch([state], 3100);
    commandExit(state, '_action-before-delivery-lint', 1, 3200);
    dispatch([state], 3300);
    const effects = commandExit(state, '_action-before-delivery-check', 0, 3400);
    expect(kinds(effects)).toEqual(['deliver']);
  });

  it('run before an automatic delivery', () => {
    const state = start(TEXT, { autoDeliver: true });
    dispatch([state], 1500);
    finish(state, 'done');
    const effects = transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'm1' } },
      2500,
    );
    expect(kinds(effects)).not.toContain('deliver');
    expect(state.run.pendingDelivery).toMatchObject({ auto: true, checks: true });
    expect(kinds(dispatch([state], 2600))).toEqual(['run_action']);
  });

  it('run for a delivery that the commit message author continues', () => {
    const text = configText(`  actions:
    lint: { run: "a" }
  stages:
    before_delivery: [lint]
  delivery: { mode: commit, message_specialist: writer, message_prompt: Пиши кратко }`);
    const state = start(text);
    finishWork(state);
    transition(
      state,
      { kind: 'deliver_requested', groups: null, force: false, files: ['a.ts'] },
      3000,
    );
    expect(state.message).toBeNull();
    dispatch([state], 3100);
    commandExit(state, '_action-before-delivery-lint', 0, 3200);
    // The files of the request survive the wait for the checks.
    expect(state.message?.task).toContain('- a.ts');
    expect(state.message?.task.endsWith('Пиши кратко')).toBe(true);
  });

  it('do not restart a delivery that the restart of the daemon cut off at an action', () => {
    const state = merged();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    dispatch([state], 3100);
    const effects = transition(state, { kind: 'interrupted' }, 4000);
    expect(effects).toEqual([]);
    expect(state.run.pendingDelivery).toBeNull();
    const lint = lastOf(state, '_action-before-delivery-lint');
    expect(lint.status).toBe('failed');
    expect(lint.reason).toBe('interrupted');
    expect(lastOf(state, '_action-before-delivery-check').status).toBe('cancelled');
  });
});

describe('actions after delivery', () => {
  function delivered(text = configText(AFTER_DELIVERY)): { state: RunState; effects: Effect[] } {
    const state = start(text);
    finishWork(state);
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    const effects = transition(
      state,
      {
        kind: 'delivery_finished',
        result: { kind: 'applied', files: ['a.ts'], conflicts: [], commit: null },
      },
      3100,
    );
    return { state, effects };
  }

  it('start instead of the cleanup and keep the run open', () => {
    const { state, effects } = delivered();
    expect(effects).toEqual([]);
    expect(state.run.finishedAt).toBeNull();
    expect(kinds(dispatch([state], 3200))).toEqual(['run_action']);
  });

  it('clean up when they are done', () => {
    const { state } = delivered();
    dispatch([state], 3200);
    expect(commandExit(state, '_action-after-delivery-commit', 0, 3300)).toEqual([
      { kind: 'cleanup', run: 'run000000001' },
    ]);
    expect(state.run.finishedAt).not.toBeNull();
  });

  it('do not clean up with keep, but still run', () => {
    const { state } = delivered(configText(`${AFTER_DELIVERY}\n  delivery: { keep: true }`));
    dispatch([state], 3200);
    expect(commandExit(state, '_action-after-delivery-commit', 0, 3300)).toEqual([]);
    expect(lastOf(state, '_action-after-delivery-commit').status).toBe('merged');
  });

  it('defer the cleanup after a failure until a retry succeeds', () => {
    const { state } = delivered();
    dispatch([state], 3200);
    expect(commandExit(state, '_action-after-delivery-commit', 1, 3300)).toEqual([]);
    expect(state.groups[0]?.delivery.state).toBe('applied');
    transition(state, { kind: 'retry', group: '_action-after-delivery-commit' }, 3400);
    dispatch([state], 3500);
    expect(kinds(commandExit(state, '_action-after-delivery-commit', 0, 3600))).toEqual([
      'cleanup',
    ]);
  });

  it('clean up when the failed action is cancelled', () => {
    const { state } = delivered();
    dispatch([state], 3200);
    commandExit(state, '_action-after-delivery-commit', 1, 3300);
    const effects = transition(
      state,
      { kind: 'cancel', group: '_action-after-delivery-commit' },
      3400,
    );
    expect(kinds(effects)).toEqual(['cleanup']);
  });

  it('clean up when the failure is allowed', () => {
    const { state } = delivered(
      configText(
        AFTER_DELIVERY.replace('run: "git commit -am x"', 'run: "x", on_failure: continue'),
      ),
    );
    dispatch([state], 3200);
    expect(kinds(commandExit(state, '_action-after-delivery-commit', 1, 3300))).toEqual([
      'cleanup',
    ]);
  });

  it('wait for the last of the groups', () => {
    const state = start(configText(AFTER_DELIVERY), { groups: 2 });
    dispatch([state], 1500);
    finish(state, 'done', { slug: 'gruppa-1' });
    finish(state, 'done', { slug: 'gruppa-2' });
    for (const group of state.groups) {
      transition(
        state,
        { kind: 'merge_finished', group: group.slug, outcome: { kind: 'merged', commit: 'm' } },
        2500,
      );
    }
    transition(
      state,
      { kind: 'deliver_requested', groups: ['gruppa-1'], force: false, files: [] },
      3000,
    );
    transition(
      state,
      {
        kind: 'delivery_finished',
        result: { kind: 'applied', files: ['a'], conflicts: [], commit: null },
      },
      3100,
    );
    expect(state.actions).toEqual([]);
    transition(
      state,
      { kind: 'deliver_requested', groups: ['gruppa-2'], force: false, files: [] },
      3200,
    );
    transition(
      state,
      {
        kind: 'delivery_finished',
        result: { kind: 'applied', files: ['b'], conflicts: [], commit: null },
      },
      3300,
    );
    expect(state.actions.map((group) => group.slug)).toEqual(['_action-after-delivery-commit']);
  });

  it('are not started after a delivery marked by hand', () => {
    const state = start(configText(AFTER_DELIVERY));
    finishWork(state);
    const effects = transition(state, { kind: 'delivered_marked', groups: null }, 3000);
    expect(state.actions).toEqual([]);
    expect(effects).toEqual([{ kind: 'cleanup', run: 'run000000001' }]);
  });

  it('fail with interrupted after a restart and are not started again', () => {
    const { state } = delivered();
    dispatch([state], 3200);
    const effects = transition(state, { kind: 'interrupted' }, 4000);
    expect(effects).toEqual([]);
    const group = lastOf(state, '_action-after-delivery-commit');
    expect(group.status).toBe('failed');
    expect(group.reason).toBe('interrupted');
    expect(dispatch([state], 4100)).toEqual([]);
  });

  it('store the data of the delivery for the environment of the command', () => {
    const { state } = delivered();
    expect(state.groups[0]?.delivery).toMatchObject({
      state: 'applied',
      files: ['a.ts'],
      message: expect.stringContaining('Группа 1'),
    });
  });
});

describe('specialist actions', () => {
  const TEXT = configText(
    `  actions:
    notes: { specialist: writer, additional_prompt: Пиши заметки }
  stages:
    before_delivery: [notes]`,
  );

  function merged(): RunState {
    const state = start(TEXT);
    finishWork(state);
    return state;
  }

  it('run as a step of the specialist with the usual limits', () => {
    const state = merged();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    expect(dispatch([state], 3100)).toEqual([
      {
        kind: 'start_attempt',
        run: 'run000000001',
        group: '_action-before-delivery-notes',
        seq: 1,
      },
    ]);
    const attempt = runningAttempt(state, '_action-before-delivery-notes');
    expect(attempt).toMatchObject({ specialist: 'writer', runtime: 'claude', stepId: 'notes' });
    expect(attempt.input.prompt).toContain('Пиши заметки');
  });

  it('go on when the specialist reports done, without a commit effect', () => {
    const state = merged();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    dispatch([state], 3100);
    const effects = finish(state, 'done', { slug: '_action-before-delivery-notes' });
    expect(kinds(effects)).toEqual(['deliver']);
    expect(lastOf(state, '_action-before-delivery-notes').status).toBe('merged');
  });

  it('stop the pipeline when the specialist rejects', () => {
    const state = merged();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    dispatch([state], 3100);
    finish(state, 'rejected', { slug: '_action-before-delivery-notes', feedback: 'плохо' });
    expect(lastOf(state, '_action-before-delivery-notes').status).toBe('failed');
    expect(state.run.pendingDelivery).toBeNull();
  });

  it('commit the changes of the specialist before the split to the run', () => {
    const text = configText(
      `  actions:
    notes: { specialist: writer }
  stages:
    before_split: [notes]`,
      SPLIT_PIPELINE,
    );
    const state = start(text, { split: true });
    dispatch([state], 1500);
    const effects = finish(state, 'done', { slug: '_action-before-split-notes' });
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'commit', group: '_action-before-split-notes' }),
    );
  });

  it('ask the human like any other step', () => {
    const state = merged();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    dispatch([state], 3100);
    finish(state, 'needs_human', { slug: '_action-before-delivery-notes', feedback: 'как?' });
    expect(lastOf(state, '_action-before-delivery-notes').status).toBe('needs_human');
    expect(runPhase(state)).toBe('needs_human');
  });
});

describe('the list of stages', () => {
  const FULL = configText(
    `  actions:
    commit: { run: "git commit" }
    prepare: { run: "make", name: Подготовка }
  stages:
    before_split: [prepare]
  delivery: { mode: commit, message_specialist: writer, resolver: fixer }`,
    `      split: { specialist: coder, max_groups: 3 }
      stages:
        after_delivery: [commit]
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: fixer }`,
  );

  it('lists the stages of a full pipeline in order', () => {
    const resolved = config(FULL);
    const stages = pipelineStages(resolved, runPipeline(start(FULL).run));
    expect(stages.map((stage) => stage.id)).toEqual([
      'action:before_split:prepare',
      'split',
      'step:code',
      'step:review',
      'merge',
      'message',
      'delivery',
      'resolve',
      'action:after_delivery:commit',
      'cleanup',
    ]);
  });

  it('gives each stage a section, a performer and a condition', () => {
    const resolved = config(FULL);
    const stages = pipelineStages(resolved, runPipeline(start(FULL).run));
    const byId = new Map(stages.map((stage) => [stage.id, stage]));
    expect(byId.get('action:before_split:prepare')).toMatchObject({
      kind: 'action',
      section: 'prepare',
      name: 'Подготовка',
      performer: { type: 'command', command: 'make' },
      condition: null,
    });
    expect(byId.get('step:code')).toMatchObject({
      section: 'work',
      performer: { type: 'specialist', slug: 'coder', name: 'Кодировщик' },
    });
    expect(byId.get('merge')).toMatchObject({ section: 'merge', performer: { type: 'system' } });
    expect(byId.get('message')).toMatchObject({
      section: 'delivery',
      condition: 'delivery_commit',
    });
    expect(byId.get('resolve')).toMatchObject({ section: 'delivery', condition: 'conflict' });
    expect(byId.get('action:after_delivery:commit')).toMatchObject({
      section: 'finish',
      name: 'commit',
    });
    expect(byId.get('cleanup')).toMatchObject({ section: 'finish', performer: { type: 'system' } });
    expect(stages.every((stage) => stage.status === null && stage.group === null)).toBe(true);
  });

  it('leaves out what is not configured and the cleanup with keep', () => {
    const resolved = config(configText('  delivery: { keep: true }'));
    const stages = pipelineStages(resolved, runPipeline(start(configText('')).run));
    expect(stages.map((stage) => stage.id)).toEqual(['step:code', 'merge', 'delivery']);
  });

  it('replaces the points of the pipeline, and an empty list disables them', () => {
    const text = configText(
      `  actions:
    commit: { run: "a" }
    push: { run: "b" }
  stages:
    after_delivery: [commit]`,
      `      stages: { after_delivery: [] }
      steps:
        - { id: code, specialist: coder }`,
    );
    const stages = pipelineStages(config(text), runPipeline(start(text).run));
    expect(stages.map((stage) => stage.id)).not.toContain('action:after_delivery:commit');
    const other = text.replace('after_delivery: []', 'after_delivery: [push]');
    expect(
      pipelineStages(config(other), runPipeline(start(other).run)).map((stage) => stage.id),
    ).toContain('action:after_delivery:push');
  });

  it('carries the status and the group of a stage in a run', () => {
    const state = start(configText(AFTER_DELIVERY));
    finishWork(state);
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    transition(
      state,
      {
        kind: 'delivery_finished',
        result: { kind: 'applied', files: ['a'], conflicts: [], commit: null },
      },
      3100,
    );
    dispatch([state], 3200);
    const find = (id: string) => runStages(state).find((stage) => stage.id === id);
    expect(find('action:after_delivery:commit')).toMatchObject({
      status: 'running',
      group: '_action-after-delivery-commit',
    });
    expect(find('step:code')?.status).toBe('done');
    commandExit(state, '_action-after-delivery-commit', 0, 3300);
    expect(find('action:after_delivery:commit')?.status).toBe('done');
  });
});

describe('prompts of the built-in steps', () => {
  it('append message_prompt to the task of the commit message author', () => {
    const state = start(
      configText(
        '  delivery: { mode: commit, message_specialist: writer, message_prompt: "Пиши по-русски" }',
      ),
    );
    finishWork(state);
    transition(
      state,
      { kind: 'deliver_requested', groups: null, force: false, files: ['a.ts'] },
      3000,
    );
    const task = state.message?.task ?? '';
    expect(task.endsWith('Пиши по-русски')).toBe(true);
    expect(task).toContain('Changed files:\n- a.ts');
  });

  it('leave the task as it was without message_prompt', () => {
    const state = start(configText('  delivery: { mode: commit, message_specialist: writer }'));
    finishWork(state);
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    expect(state.message?.task.endsWith('- (none)')).toBe(true);
  });

  it('append resolver_prompt to the task of the resolver', () => {
    const state = start(
      configText(
        '  delivery: { resolver: fixer, resolver_prompt: "Всегда сохраняй правки пользователя" }',
      ),
    );
    finishWork(state);
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 3000);
    transition(
      state,
      {
        kind: 'delivery_finished',
        result: { kind: 'refused', reason: 'c', files: ['a.ts'], conflict: true },
      },
      3100,
    );
    transition(state, { kind: 'resolve_prepared', conflicts: ['a.ts'] }, 3200);
    const task = state.resolve?.task ?? '';
    expect(task.endsWith('Всегда сохраняй правки пользователя')).toBe(true);
    expect(task).toContain('Conflicting files:\n- a.ts');
  });
});

describe('actions before an automatic delivery', () => {
  const TEXT = configText(`  actions:
    lint: { run: "a" }
    check: { run: "b" }
  stages:
    before_delivery: [lint, check]`);

  /** The work is merged and the automatic delivery waits for the first check. */
  function waiting(): RunState {
    const state = start(TEXT, { autoDeliver: true });
    dispatch([state], 1500);
    finish(state, 'done');
    transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'm1' } },
      2500,
    );
    dispatch([state], 2600);
    return state;
  }

  it('does not restart a failed check', () => {
    const state = waiting();
    const effects = commandExit(state, '_action-before-delivery-lint', 1, 3000);
    expect(effects).toEqual([]);
    expect(state.run.pendingDelivery).toBeNull();
    expect(lastOf(state, '_action-before-delivery-lint').status).toBe('failed');
    expect(dispatch([state], 3100)).toEqual([]);
    expect(isRunFinished(state)).toBe(true);
  });

  it('does not restart a cancelled check', () => {
    const state = waiting();
    transition(state, { kind: 'cancel', group: '_action-before-delivery-lint' }, 3000);
    expect(state.run.pendingDelivery).toBeNull();
    expect(dispatch([state], 3100)).toEqual([]);
  });

  it('does not restart the checks of a cancelled run', () => {
    const state = waiting();
    transition(state, { kind: 'cancel', group: null }, 3000);
    expect(dispatch([state], 3100)).toEqual([]);
    expect(state.run.pendingDelivery).toBeNull();
  });

  it('does not restart a check cut off by the restart of the daemon', () => {
    const state = waiting();
    const effects = transition(state, { kind: 'interrupted' }, 3000);
    expect(effects).toEqual([]);
    expect(state.run.pendingDelivery).toBeNull();
    expect(lastOf(state, '_action-before-delivery-lint').reason).toBe('interrupted');
    expect(dispatch([state], 3100)).toEqual([]);
  });

  it('goes on to deliver after a retry that succeeds', () => {
    const state = waiting();
    commandExit(state, '_action-before-delivery-lint', 1, 3000);
    transition(state, { kind: 'retry', group: '_action-before-delivery-lint' }, 3100);
    dispatch([state], 3200);
    commandExit(state, '_action-before-delivery-lint', 0, 3300);
    // The queued check ran after it; the delivery follows the last one.
    dispatch([state], 3400);
    let effects = commandExit(state, '_action-before-delivery-check', 0, 3500);
    for (let round = 0; round < 4 && !kinds(effects).includes('deliver'); round += 1) {
      const started = dispatch([state], 3600 + round);
      const running = started.find((effect) => effect.kind === 'run_action');
      if (!running || running.kind !== 'run_action') break;
      effects = commandExit(state, running.group, 0, 3700 + round);
    }
    expect(kinds(effects)).toContain('deliver');
  });
});

describe('actions before delivery that do not stop the pipeline', () => {
  const TEXT = configText(`  actions:
    lint: { run: "a", on_failure: continue }
  stages:
    before_delivery: [lint]`);

  function waiting(autoDeliver: boolean): RunState {
    const state = start(TEXT, { autoDeliver });
    dispatch([state], 1500);
    finish(state, 'done');
    transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'm1' } },
      2500,
    );
    if (!autoDeliver) {
      transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 2550);
    }
    expect(dispatch([state], 2600).map((effect) => effect.kind)).toContain('run_action');
    return state;
  }

  it('does not run an interrupted command again and goes on to deliver (auto)', () => {
    const state = waiting(true);
    const effects = transition(state, { kind: 'interrupted' }, 3000);
    expect(effects.map((effect) => effect.kind)).not.toContain('run_action');
    expect(lastOf(state, '_action-before-delivery-lint').reason).toBe('interrupted');
    expect(state.run.pendingDelivery).not.toBeNull();
    expect(effects.map((effect) => effect.kind)).toContain('deliver');
    const next = [...effects, ...dispatch([state], 3100)].map((effect) => effect.kind);
    expect(next).not.toContain('run_action');
  });

  it('does not lose the delivery of an interrupted check (manual)', () => {
    const state = waiting(false);
    transition(state, { kind: 'interrupted' }, 3000);
    expect(state.run.pendingDelivery).not.toBeNull();
    const effects = [...dispatch([state], 3100)];
    expect(effects.map((effect) => effect.kind)).not.toContain('run_action');
  });

  it('cancelling the whole run does not deliver', () => {
    const state = waiting(true);
    const effects = transition(state, { kind: 'cancel', group: null }, 3000);
    expect(effects.map((effect) => effect.kind)).not.toContain('deliver');
    expect(state.message).toBeNull();
    expect(state.run.pendingDelivery).toBeNull();
    expect(dispatch([state], 3100).map((effect) => effect.kind)).not.toContain('deliver');
  });
});

describe('commit failure of an action before the split', () => {
  it('fails the action and holds the pipeline', () => {
    const text = configText(
      `  actions:
    prepare: { run: "a" }
  stages:
    before_split: [prepare]`,
      SPLIT_PIPELINE,
    );
    const state = start(text, { split: true });
    dispatch([state], 1500);
    commandExit(state, '_action-before-split-prepare', 0);
    transition(
      state,
      { kind: 'commit_failed', group: '_action-before-split-prepare', message: 'нет места' },
      3500,
    );
    const group = lastOf(state, '_action-before-split-prepare');
    expect(group.status).toBe('failed');
    expect(group.reason).toContain('нет места');
    expect(dispatch([state], 3600)).toEqual([]);
  });
});

describe('pause and messages with actions', () => {
  it('a pause stops a specialist before the split but not a command', () => {
    const text = configText(
      `  actions:
    notes: { specialist: writer }
  stages:
    before_split: [notes]`,
      SPLIT_PIPELINE,
    );
    const state = start(text, { split: true });
    dispatch([state], 1500);
    const effects = transition(state, { kind: 'hold', hold: 'paused' }, 2000);
    expect(effects).toEqual([
      { kind: 'stop_attempt', run: 'run000000001', group: '_action-before-split-notes', seq: 1 },
    ]);
  });

  it('a pause leaves a running command alone', () => {
    const text = configText(
      `  actions:
    prepare: { run: "a" }
  stages:
    before_split: [prepare]`,
      SPLIT_PIPELINE,
    );
    const state = start(text, { split: true });
    dispatch([state], 1500);
    expect(transition(state, { kind: 'hold', hold: 'paused' }, 2000)).toEqual([]);
  });

  it('refuses a message to a command', () => {
    const text = configText(
      `  actions:
    prepare: { run: "a" }
  stages:
    before_split: [prepare]`,
      SPLIT_PIPELINE,
    );
    const state = start(text, { split: true });
    dispatch([state], 1500);
    const attempt = runningAttempt(state, '_action-before-split-prepare');
    expect(() =>
      transition(
        state,
        { kind: 'message', group: '_action-before-split-prepare', seq: attempt.seq, text: 'эй' },
        2000,
      ),
    ).toThrow(/command/);
  });

  it('a specialist action cut off by a restart fails as interrupted, like other steps', () => {
    const text = configText(
      `  actions:
    notes: { specialist: writer }
  stages:
    before_split: [notes]`,
      SPLIT_PIPELINE,
    );
    const state = start(text, { split: true });
    dispatch([state], 1500);
    transition(state, { kind: 'interrupted' }, 4000);
    const group = lastOf(state, '_action-before-split-notes');
    expect(group.status).toBe('failed');
    expect(group.reason).toBe('interrupted');
  });
});

describe('merges and checks before delivery', () => {
  const TEXT = configText(`  actions:
    lint: { run: "a" }
    check: { run: "b" }
  stages:
    before_delivery: [lint, check]`);
  const LINT = '_action-before-delivery-lint';
  const CHECK = '_action-before-delivery-check';

  const mergeFinished = (state: RunState, group: string, now: number): Effect[] =>
    transition(
      state,
      { kind: 'merge_finished', group, outcome: { kind: 'merged', commit: `m-${group}` } },
      now,
    );

  const deliverFirst = (state: RunState, now: number): Effect[] =>
    transition(
      state,
      { kind: 'deliver_requested', groups: ['gruppa-1'], force: false, files: [] },
      now,
    );

  /** The first group is merged, the second one still works. */
  function firstMerged(): RunState {
    const state = start(TEXT, { groups: 2 });
    dispatch([state], 1500);
    finish(state, 'done', { slug: 'gruppa-1', now: 2000 });
    mergeFinished(state, 'gruppa-1', 2100);
    return state;
  }

  /** The first check runs and the second group has reached its merge. */
  function merging(): RunState {
    const state = firstMerged();
    deliverFirst(state, 2200);
    expect(kinds(dispatch([state], 2300))).toEqual(['run_action']);
    finish(state, 'done', { slug: 'gruppa-2', now: 2400 });
    return state;
  }

  const second = (state: RunState) => findGroup(state, 'gruppa-2')!;

  it('hold a merge while a check runs or waits for its turn, and let it go after them', () => {
    const state = merging();
    expect(second(state).status).toBe('merging');
    expect(second(state).mergeInFlight).toBe(false);
    expect(kinds(commandExit(state, LINT, 0, 2500))).not.toContain('merge');
    expect(second(state).mergeInFlight).toBe(false);
    dispatch([state], 2600);
    expect(kinds(commandExit(state, CHECK, 0, 2700))).toContain('merge');
    expect(second(state).mergeInFlight).toBe(true);
  });

  it('do not hold a merge behind a check that stopped the pipeline', () => {
    const state = merging();
    expect(kinds(commandExit(state, LINT, 1, 2500))).toContain('merge');
    expect(second(state).mergeInFlight).toBe(true);
  });

  it('hold a merge during an explicit retry of a failed check', () => {
    const state = firstMerged();
    deliverFirst(state, 2200);
    dispatch([state], 2300);
    commandExit(state, LINT, 1, 2400);
    expect(state.run.pendingDelivery).toBeNull();
    transition(state, { kind: 'retry', group: LINT }, 2500);
    finish(state, 'done', { slug: 'gruppa-2', now: 2600 });
    expect(second(state).status).toBe('merging');
    expect(second(state).mergeInFlight).toBe(false);
  });

  it('do not start while a merge is in flight, and start after it', () => {
    const state = firstMerged();
    finish(state, 'done', { slug: 'gruppa-2', now: 2200 });
    expect(second(state).mergeInFlight).toBe(true);
    deliverFirst(state, 2300);
    expect(dispatch([state], 2400)).toEqual([]);
    mergeFinished(state, 'gruppa-2', 2500);
    expect(kinds(dispatch([state], 2600))).toEqual(['run_action']);
  });
});
