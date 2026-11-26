import { rejected } from '../../../../platform/errors/index.ts';
import type { DeliveryMode } from '../../../swarm-config/types/index.ts';

export interface DeliveryBranch {
  name: string;
  strategy: 'existing' | 'create';
}

/** Validates a local branch name using the rules of git-check-ref-format --branch. */
export function validDeliveryBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '@' &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.includes('..') &&
    !name.includes('@{') &&
    !/[\x00-\x20\x7f~^:?*\\\[]/.test(name) &&
    name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'))
  );
}

/** Rejects malformed targets and incompatible effective delivery settings. */
export function checkDeliveryBranch(
  target: DeliveryBranch | null | undefined,
  auto: boolean | null | undefined,
  mode: DeliveryMode | null | undefined,
  server = false,
): void {
  if (target == null) return;
  if (
    typeof target !== 'object' ||
    typeof target.name !== 'string' ||
    !validDeliveryBranchName(target.name) ||
    (target.strategy !== 'existing' && target.strategy !== 'create') ||
    Object.keys(target).some((key) => key !== 'name' && key !== 'strategy')
  )
    throw rejected(
      'deliveryBranch must contain a valid local branch name and strategy existing or create',
    );
  if (server) throw rejected('deliveryBranch is not allowed in server mode');
  if (auto === false || (mode != null && mode !== 'commit')) {
    throw rejected('deliveryBranch requires autoDeliver: true and deliveryMode: commit');
  }
}
