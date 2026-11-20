import { rejected } from '../../../../platform/errors/index.ts';
import { serverSettings } from '../identity/identity.ts';
import type { IpcContext } from '../types.ts';

/** The author as the lists and the report ask for it: a user id or `me`. */
export const ME = 'me';

/** True when the daemon works in the server mode: only then the records have authors to filter by. */
export function serverModeOn(context: IpcContext): boolean {
  return serverSettings(context).enabled;
}

/**
 * The user id of an `author` parameter: `me` becomes the id of the user making the request.
 * Refused in the local mode and for `me` from an actor that is not a user.
 */
export function authorParam(context: IpcContext, author: string | undefined): string | undefined {
  if (author === undefined) return undefined;
  if (!serverModeOn(context)) throw rejected('author filter needs the server mode');
  if (author !== ME) return author;
  if (context.actor.kind !== 'user') {
    throw rejected('author "me" needs a signed in user, not the local or system actor');
  }
  return context.actor.user.id;
}
