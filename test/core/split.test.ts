import { describe, expect, it } from 'vitest';

import { SPLIT_GROUP, dispatch, stepsOf, transition, type RunState } from '../../src/core/index.ts';

import { CONFIG_TEXT, config, finish, run, runningAttempt } from './helpers.ts';

const SPLIT_CONFIG = CONFIG_TEXT.replace(
  '    feature:\n      steps:',
  '    feature:\n      split: { specialist: plan, max_groups: 3 }\n      steps:',
);

function splitting(): RunState {
  const state = run(1, { split: true, configText: SPLIT_CONFIG });
  dispatch([state], 1100);
  return state;
}

function propose(state: RunState, groups: { title: string; task: string }[]) {
  const attempt = runningAttempt(state, SPLIT_GROUP);
  return transition(state, { kind: 'split_proposed', seq: attempt.seq, groups }, 1200);
}

describe('split step', () => {
  it('runs only the splitting specialist first, then creates the proposed groups', () => {
    const state = splitting();
    expect(state.groups).toEqual([]);
    const attempt = runningAttempt(state, SPLIT_GROUP);
    expect(attempt).toMatchObject({ specialist: 'plan', stepId: 'split' });
    expect(attempt.input.prompt).toContain('swarm_split');
    propose(state, [
      { title: 'Вход', task: 'сделать вход' },
      { title: 'Регистрация', task: 'сделать регистрацию' },
    ]);
    const effects = finish(state, 'done', { slug: SPLIT_GROUP });
    expect(effects).toEqual([]);
    expect(state.split?.status).toBe('merged');
    expect(state.groups.map((group) => [group.slug, group.status])).toEqual([
      ['vhod', 'queued'],
      ['registratsiya', 'queued'],
    ]);
    dispatch([state], 1300);
    expect(runningAttempt(state, 'vhod').stepId).toBe('plan');
    expect(state.run.finishedAt).toBeNull();
  });

  it('puts the additional prompt of the split before the swarm_split instruction', () => {
    const text = CONFIG_TEXT.replace(
      '    feature:\n      steps:',
      '    feature:\n      split: { specialist: plan, additional_prompt: Не больше одной группы на модуль }\n      steps:',
    );
    const state = run(1, { split: true, configText: text });
    dispatch([state], 1100);
    const prompt = runningAttempt(state, SPLIT_GROUP).input.prompt;
    const extra = prompt.indexOf('Не больше одной группы на модуль');
    expect(extra).toBeGreaterThan(prompt.indexOf('задача 1'));
    expect(extra).toBeLessThan(prompt.indexOf('swarm_split'));
  });

  it('skips splitting when groups are given explicitly', () => {
    const state = run(3, { split: true, configText: SPLIT_CONFIG });
    expect(state.split).toBeNull();
    expect(state.groups).toHaveLength(3);
  });

  it('fails with no groups when the specialist reports done without a proposal', () => {
    const state = splitting();
    finish(state, 'done', { slug: SPLIT_GROUP });
    expect(state.split).toMatchObject({ status: 'failed', reason: 'no groups' });
    expect(state.run.finishedAt).not.toBeNull();
    transition(state, { kind: 'retry', group: SPLIT_GROUP }, 1500);
    expect(state.run.finishedAt).toBeNull();
    dispatch([state], 1600);
    expect(runningAttempt(state, SPLIT_GROUP).seq).toBe(2);
  });

  it('rejects too many groups and empty titles, and keeps the last valid proposal', () => {
    const state = splitting();
    const many = Array.from({ length: 4 }, (_, index) => ({ title: `g${index}`, task: 't' }));
    expect(() => propose(state, many)).toThrow('from 1 to 3 groups, got 4');
    expect(() => propose(state, [{ title: ' ', task: 't' }])).toThrow('non-empty title');
    propose(state, [{ title: 'A', task: 'a' }]);
    propose(state, [{ title: 'B', task: 'b' }]);
    finish(state, 'done', { slug: SPLIT_GROUP });
    expect(state.groups.map((group) => group.title)).toEqual(['B']);
  });

  it('asks a human and cancels like a normal step', () => {
    const state = splitting();
    finish(state, 'needs_human', { slug: SPLIT_GROUP, feedback: 'на сколько частей?' });
    expect(state.split?.status).toBe('needs_human');
    transition(state, { kind: 'answer', group: SPLIT_GROUP, answer: 'на две' }, 1400);
    dispatch([state], 1500);
    expect(runningAttempt(state, SPLIT_GROUP).input.humanAnswer).toBe('на две');
    transition(state, { kind: 'cancel', group: null }, 1600);
    expect(state.split?.status).toBe('cancelled');
    expect(state.run.finishedAt).toBe(1600);
  });

  it('rejects swarm_split outside the split step', () => {
    const state = run(1);
    dispatch([state], 1);
    expect(() =>
      transition(state, { kind: 'split_proposed', seq: 1, groups: [{ title: 'a', task: 'b' }] }, 2),
    ).toThrow('not a running split step');
  });
});

describe('specialist limit on the split step', () => {
  it('makes the second split wait while the first one is running', () => {
    const text = SPLIT_CONFIG.replace(
      'plan: { name: Планировщик,',
      'plan: { name: Планировщик, max: 1,',
    );
    const first = run(1, { id: 'run000000001', split: true, configText: text });
    const second = run(1, { id: 'run000000002', now: 2000, split: true, configText: text });
    expect(dispatch([first, second], 3000)).toHaveLength(1);
    expect(runningAttempt(first, SPLIT_GROUP).stepId).toBe('split');
    expect(second.split?.status).toBe('queued');
  });
});

describe('split into another workflow', () => {
  const TEXT = `${CONFIG_TEXT}    explore:
      steps:
        - { id: research, specialist: reviewer }
        - { id: write, specialist: coder, on_reject: { goto: research, max_rounds: 2 } }
`.replace(
    '    feature:\n      steps:',
    '    feature:\n      split: { specialist: plan, workflow: explore }\n      steps_placeholder:',
  );
  const CONFIG = TEXT.replace(/      steps_placeholder:\n(        - .*\n){4}/, '');

  it('starts the proposed groups at the first step of the target', () => {
    const state = run(1, { split: true, configText: CONFIG });
    dispatch([state], 1100);
    propose(state, [
      { title: 'a', task: 'a' },
      { title: 'b', task: 'b' },
    ]);
    finish(state, 'done', { slug: SPLIT_GROUP });
    dispatch([state], 1300);
    const workers = state.groups.filter((item) => item.slug !== SPLIT_GROUP);
    expect(workers).toHaveLength(2);
    for (const worker of workers) {
      expect(worker.attempts[0]).toMatchObject({ stepId: 'research', specialist: 'reviewer' });
    }
  });

  it('starts explicit groups at the first step of the target without a split step', () => {
    const state = run(2, { split: true, configText: CONFIG });
    expect(state.split).toBeNull();
    dispatch([state], 1100);
    expect(state.groups.map((item) => item.attempts[0]?.stepId)).toEqual(['research', 'research']);
  });

  it('returns to a step of the target on rejection', () => {
    const state = run(2, { split: true, configText: CONFIG });
    expect(state.split).toBeNull();
    dispatch([state], 1100);
    finish(state, 'done');
    dispatch([state], 1500);
    finish(state, 'rejected', { feedback: 'мало' });
    dispatch([state], 1600);
    expect(runningAttempt(state).stepId).toBe('research');
    expect(runningAttempt(state).input.feedback).toBe('мало');
  });

  it('keeps the steps of the run when the target changes in the configuration', () => {
    const state = run(1, { configText: CONFIG });
    const later = config(CONFIG);
    later.workflows.find((item) => item.id === 'explore')!.steps.pop();
    expect(stepsOf(state.run, state.groups[0]!).map((item) => item.id)).toEqual([
      'research',
      'write',
    ]);
  });
});
