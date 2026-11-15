import type { TaskLinkView } from '../../../shared/api/types.ts';

export type LinkKind = TaskLinkView['kind'];
export const linkKinds: readonly LinkKind[] = ['blocked_by', 'parent', 'related', 'duplicates'];
export const inverseLinkKinds: readonly LinkKind[] = ['blocked_by', 'parent', 'duplicates'];
