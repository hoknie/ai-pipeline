import type { TFunction } from 'i18next';

const REASONS = [
  'needs_human',
  'failed',
  'conflict',
  'cancelled',
  'apply_failed',
  'usage_limit',
] as const;

export function reasonText(reason: string, t: TFunction): string {
  const known = REASONS.find((candidate) => candidate === reason);
  return known ? t(`queue.reasons.${known}`) : reason;
}
