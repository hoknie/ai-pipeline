import type { ReviewPolicy, Step } from '../../../types/pipeline.ts';
import {
  addError,
  join,
  readEntries,
  readInteger,
  readMapping,
  readString,
  type ValidateContext,
} from '../../validate-context.ts';

export function checkReviewPolicy(
  ctx: ValidateContext,
  value: unknown,
  path: string,
): ReviewPolicy | undefined {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return undefined;
  readEntries(ctx, mapping, path, [
    'stagnant_rounds',
    'recovery_step',
    'escalation_specialist',
    'required_checks',
  ]);
  const policy: ReviewPolicy = {
    stagnantRounds:
      'stagnant_rounds' in mapping
        ? (readInteger(ctx, mapping.stagnant_rounds, join(path, 'stagnant_rounds'), [1, 10]) ?? 2)
        : 2,
    requiredChecks: [],
  };
  for (const [raw, key] of [
    ['recovery_step', 'recoveryStep'],
    ['escalation_specialist', 'escalationSpecialist'],
  ] as const) {
    if (raw in mapping) {
      const text = readString(ctx, mapping[raw], join(path, raw));
      if (text !== null) policy[key] = text;
    }
  }
  if ('required_checks' in mapping) {
    if (!Array.isArray(mapping.required_checks) || mapping.required_checks.length > 50)
      addError(ctx, join(path, 'required_checks'), 'must be a list of at most 50 commands');
    else
      mapping.required_checks.forEach((value, index) => {
        const command = readString(ctx, value, `${path}.required_checks[${index}]`);
        if (command !== null) {
          if (command.length > 2000)
            addError(ctx, `${path}.required_checks[${index}]`, 'must be at most 2000 characters');
          if (policy.requiredChecks.includes(command))
            addError(ctx, `${path}.required_checks[${index}]`, 'duplicate command');
          policy.requiredChecks.push(command);
        }
      });
  }
  return policy;
}

export function checkReviewTargets(
  ctx: ValidateContext,
  steps: Step[],
  path: string,
  known: string[],
): void {
  for (const [index, step] of steps.entries()) {
    const policy = step.onReject?.review;
    if (!policy) continue;
    const field = `${path}[${index}].on_reject.review`;
    const target = steps.findIndex((item) => item.id === step.onReject?.goto);
    if (policy.recoveryStep) {
      const recovery = steps.findIndex((item) => item.id === policy.recoveryStep);
      if (recovery < 0 || recovery >= target)
        addError(ctx, `${field}.recovery_step`, 'must point to a step earlier than on_reject.goto');
    }
    if (policy.escalationSpecialist && !known.includes(policy.escalationSpecialist))
      addError(
        ctx,
        `${field}.escalation_specialist`,
        `unknown specialist \`${policy.escalationSpecialist}\``,
      );
    if (policy.escalationSpecialist && !policy.recoveryStep)
      addError(ctx, `${field}.escalation_specialist`, 'requires recovery_step');
    if (
      steps.some(
        (other) =>
          other !== step && other.onReject?.review && other.onReject.goto === step.onReject?.goto,
      )
    )
      addError(ctx, field, 'managed review steps must have distinct goto targets');
  }
}
