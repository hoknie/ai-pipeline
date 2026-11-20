import { describe, expect, it } from 'vitest';

import { transition } from '../../../src/feature/runs/machine/index.ts';
import { finish, group, run, runningAttempt, step } from './helpers.ts';

const project = { path: 'acme/backend/api', server: 'registry' };
const event = (seq = 1, registryProject = project) =>
  ({ kind: 'registry_project_resolved', group: 'group-1', seq, registryProject }) as const;

describe('registry_project_resolved', () => {
  it('writes the project into the input of an attempt that is preparing, without effects', () => {
    const state = run(1);
    step(state);
    expect(transition(state, event(), 2000)).toEqual([]);
    expect(runningAttempt(state).input.registryProject).toEqual(project);
  });

  it('keeps the first value when the event repeats', () => {
    const state = run(1);
    step(state);
    transition(state, event(), 2000);
    transition(state, event(1, { path: 'acme/other', server: 'other' }), 2001);
    expect(runningAttempt(state).input.registryProject).toEqual(project);
  });

  it('is ignored once the agent runs', () => {
    const state = run(1);
    step(state);
    runningAttempt(state).sessionId = 'session-1';
    transition(state, event(), 2000);
    expect(runningAttempt(state).input.registryProject).toBeUndefined();
  });

  it('is ignored for a finished attempt, an unknown attempt and an unknown group', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    transition(state, event(), 3000);
    transition(state, { ...event(), group: 'missing' }, 3000);
    transition(state, event(9), 3000);
    for (const attempt of group(state).attempts) {
      expect(attempt.input.registryProject).toBeUndefined();
    }
  });
});
