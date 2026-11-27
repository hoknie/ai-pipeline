import type { ReviewPolicy } from '../../../../feature/swarm-config/types/index.ts';

export function reviewPolicyValue(policy: ReviewPolicy): Record<string, unknown> {
  return {
    stagnant_rounds: policy.stagnantRounds,
    ...(policy.recoveryStep ? { recovery_step: policy.recoveryStep } : {}),
    ...(policy.escalationSpecialist ? { escalation_specialist: policy.escalationSpecialist } : {}),
    required_checks: [...policy.requiredChecks],
  };
}
