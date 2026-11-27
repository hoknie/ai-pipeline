import type { ReviewFinding } from '../../../../src/feature/agents/types/index.ts';
import type { Report, RunState } from '../../../../src/feature/runs/types/index.ts';
import { transition } from '../../../../src/feature/runs/machine/index.ts';
import { CONFIG_TEXT, finish, group, run, runningAttempt, step } from '../helpers.ts';

export { group, runningAttempt, step };

export const CONFIG = CONFIG_TEXT.replace(
  '    qa: { name: Tester }',
  '    qa: { name: Tester }\n    strong: { name: Strong coder, runtime: opencode, model: openai/strong }',
).replace(
  'goto: code, max_rounds: 3',
  'goto: code, max_rounds: 8, review: { stagnant_rounds: 2, recovery_step: plan, escalation_specialist: strong, required_checks: [npm run check] }',
);

export const finding = (id = 'R1', patch: Partial<ReviewFinding> = {}): ReviewFinding => ({
  id,
  severity: 'major',
  file: 'form.ts:10',
  scenario: 'Rename a form containing null',
  expected: 'Preserve presence, type and value',
  evidence: 'Payload drops the key',
  origin: 'initial',
  reason: 'Required data preservation',
  ...patch,
});

export function report(state: RunState, value: Report): void {
  transition(
    state,
    { kind: 'report', group: 'group-1', seq: runningAttempt(state).seq, report: value },
    2000,
  );
}

export function complete(state: RunState, value: Report): void {
  const seq = runningAttempt(state).seq;
  report(state, value);
  transition(
    state,
    {
      kind: 'attempt_exited',
      group: 'group-1',
      seq,
      exit: { sessionId: `s-${seq}`, usage: null, failure: null, outsideChanges: [] },
    },
    2000,
  );
}

export function code(state: RunState): void {
  const findings = runningAttempt(state).input.review?.findings ?? [];
  complete(state, {
    verdict: 'done',
    summary: 'Implemented preservation invariant',
    feedback: null,
    implementation: {
      files: ['form.ts', 'form.test.ts'],
      resolutions: findings
        .filter((item) => item.severity !== 'minor')
        .map((item) => ({
          id: item.id,
          change: 'Preserve raw fields until explicit edit',
          tests: 'Rename null/blank/number and explicit removal payload tests passed',
        })),
      checks: [
        {
          command: 'npm run check',
          result: 'passed',
          evidence: 'all tests passed after the final edit',
        },
      ],
    },
  });
}

export function review(state: RunState, findings: ReviewFinding[], resolved: string[] = []): void {
  complete(state, {
    verdict: findings.some((item) => item.severity !== 'minor') ? 'rejected' : 'done',
    summary: 'Verified implementation',
    feedback: null,
    review: {
      findings,
      resolved: resolved.map((id) => ({
        id,
        evidence: 'Read the repair and its regression test; invariant holds',
      })),
    },
  });
}

export function atReview(configText = CONFIG): RunState {
  const state = run(1, { configText });
  step(state);
  finish(state, 'done');
  step(state);
  code(state);
  step(state);
  return state;
}

export function revision(state: RunState, findings = [finding()], resolved: string[] = []): void {
  step(state);
  code(state);
  step(state);
  review(state, findings, resolved);
}
