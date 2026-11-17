import type { RunView } from '../../../shared/api/types.ts';

/**
 * Whether the variant or the provider of the run may change: it is not finished, or a failed or
 * cancelled group can still be retried.
 */
export function canSwitchRun(run: RunView): boolean {
  const retryable =
    run.groups.some((group) => group.status === 'failed' || group.status === 'cancelled') ||
    (run.split !== null &&
      run.split !== undefined &&
      (run.split.status === 'failed' || run.split.status === 'cancelled'));
  return !run.finished || retryable;
}
