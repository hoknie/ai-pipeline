import type { Api } from '../../../../shared/api/api.ts';
import { isServerMode } from '../../../../shared/api/http.ts';
import type { DeliveryMode } from '../../../../../../src/feature/swarm-config/types/index.ts';
import { draftValid, type QueueDraft } from '../../draft.ts';
import { useBranchValidation } from './useBranchValidation.ts';

export function useFormBranch(input: {
  effective: QueueDraft;
  api: Api | undefined;
  providerRepositories: readonly string[] | undefined;
  repository: string | null;
  autoDeliverDefault: boolean | null;
  deliveryModeDefault: DeliveryMode | null;
}) {
  const {
    effective,
    api,
    providerRepositories,
    repository,
    autoDeliverDefault,
    deliveryModeDefault,
  } = input;
  const allowed =
    !isServerMode() &&
    (effective.autoDeliver ?? autoDeliverDefault ?? true) &&
    (effective.deliveryMode ?? deliveryModeDefault ?? 'worktree') === 'commit';
  const branchValidation = useBranchValidation(
    api,
    providerRepositories ?? (repository ? [repository] : []),
    allowed ? effective.deliveryBranch : null,
  );
  const branchBlocked = !!effective.deliveryBranch && (!allowed || branchValidation !== 'valid');
  return { valid: draftValid(effective) && !branchBlocked, branchValidation, branchBlocked };
}
