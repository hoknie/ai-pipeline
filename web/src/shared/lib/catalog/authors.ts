import { useEffect, useState } from 'react';

import type { Api } from '../../api/api.ts';
import type { UserDirectoryEntry } from '../../api/types.ts';

/** What the author filters need: whether the panel works with accounts, who I am and who the others are. */
export interface AuthorChoices {
  /** The server mode with a signed in user; in the local mode the filters are not shown. */
  enabled: boolean;
  /** Id of the signed in user; null in the local mode. */
  meId: string | null;
  users: UserDirectoryEntry[];
}

const LOCAL: AuthorChoices = { enabled: false, meId: null, users: [] };

/** The mode, the signed in user and the directory of users; loaded once per mount. */
export function useAuthorChoices(api: Api): AuthorChoices {
  const [choices, setChoices] = useState<AuthorChoices>(LOCAL);
  useEffect(() => {
    let closed = false;
    api
      .accessMe(null)
      .then(async (me) => {
        if (me.actor !== 'user' || me.userId === null) return;
        const users = await api.usersDirectory().catch(() => []);
        if (!closed) setChoices({ enabled: true, meId: me.userId, users });
      })
      .catch(() => undefined);
    return () => {
      closed = true;
    };
  }, [api]);
  return choices;
}

/** The user id an `author` of the address stands for: `me` is the signed in user. */
export function authorIdOf(author: string | null | undefined, meId: string | null): string | null {
  if (author === null || author === undefined || author === '') return null;
  return author === 'me' ? meId : author;
}
