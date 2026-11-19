import type { ExceptionEntry } from './reconcile.ts';

/**
 * Old violations of size limits, purity and environment. The list only shrinks: entries are not added,
 * sizes are not raised, and an entry that is no longer needed is removed.
 */
export const exceptions: ExceptionEntry[] = [
  { rule: 'file-size', path: 'src/platform/git/delivery.ts', size: 373 },
  { rule: 'file-size', path: 'src/platform/git/workspace.ts', size: 449 },
];
