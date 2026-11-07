import type { ExceptionEntry } from './reconcile.ts';

/**
 * Старые нарушения пределов, чистоты и окружения. Список только сокращается: записи не добавляют,
 * размер не увеличивают, а запись, которая больше не нужна, удаляют.
 */
export const exceptions: ExceptionEntry[] = [
  { rule: 'file-size', path: 'src/platform/git/delivery.ts', size: 375 },
  { rule: 'file-size', path: 'src/platform/git/workspace.ts', size: 449 },
];
