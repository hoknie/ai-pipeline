import { describe, expect, it } from 'vitest';
import { userMessage } from '../../../../src/feature/agents/types/index.ts';
import { run, finish } from '../helpers.ts';
import { complete, finding, group, runningAttempt, step } from './helpers.ts';

describe('structured findings in a legacy review handoff', () => {
  it('passes complete findings even when feedback only names IDs', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state);
    finish(state, 'done');
    step(state);
    complete(state, {
      verdict: 'rejected',
      summary: '15 findings',
      feedback: 'Fix R1',
      review: { findings: [finding()], resolved: [] },
    });
    step(state);
    const input = runningAttempt(state).input;
    expect(input.review).toBeUndefined();
    expect(input.feedback).toBe('Fix R1');
    const message = userMessage(input);
    for (const text of [
      '[R1] major: form.ts:10',
      'Rename a form containing null',
      'Expected: Preserve presence, type and value',
      'Evidence: Payload drops the key',
    ])
      expect(message).toContain(text);
    expect(message.match(/\[R1\]/g)).toHaveLength(1);
    expect(group(state).attempts[2]?.report?.summary).toBe('15 findings');
  });

  it('carries only the newest structured list of each reviewer, without repeating stale findings', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state);
    finish(state, 'done');
    step(state);
    complete(state, {
      verdict: 'rejected',
      summary: 'first',
      feedback: 'Fix IDs',
      review: { findings: [finding('R1')], resolved: [] },
    });
    step(state);
    finish(state, 'done');
    step(state);
    complete(state, {
      verdict: 'rejected',
      summary: 'second',
      feedback: 'Fix new IDs',
      review: {
        findings: [finding('R2', { origin: 'regression' })],
        resolved: [{ id: 'R1', evidence: 'fixed' }],
      },
    });
    step(state);
    const message = userMessage(runningAttempt(state).input);
    expect(message).toContain('[R2]');
    expect(message).not.toContain('[R1]');
  });
});
