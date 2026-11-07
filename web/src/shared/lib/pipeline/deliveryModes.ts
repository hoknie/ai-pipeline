import type { DeliveryMode } from '../../../../../src/feature/swarm-config/types/index.ts';

/** Ways the merged result is delivered, in the order the pickers show them. */
export const DELIVERY_MODES: readonly DeliveryMode[] = ['worktree', 'commit', 'branch'];

export function isDeliveryMode(value: unknown): value is DeliveryMode {
  return DELIVERY_MODES.some((mode) => mode === value);
}
