import type { AccessMe } from '../../api/types.ts';

/**
 * Whether the user may do an action: the server decides in the end, this only turns buttons off.
 * Without an answer (local mode, a failed request) everything is allowed. An action that needs the
 * resource to be the user's own is allowed for a resource of that user only.
 */
export function allows(me: AccessMe | null, action: string, author?: string | null): boolean {
  if (me === null || me.actor !== 'user') return true;
  if (me.actions.includes(action)) return true;
  return me.conditional.includes(action) && author != null && author === me.userId;
}
