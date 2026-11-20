import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api/api.ts';
import type { AccessMe } from '../../api/types.ts';
import { allows } from './access.ts';

/** What the user may do in a project, for turning buttons off. */
export interface Access {
  /** Whether the action is allowed; for an action with `author: self`, the author of the resource. */
  can: (action: string, author?: string | null) => boolean;
  /** The hint of a button that is off for the action; `undefined` when it is allowed. */
  hint: (action: string, author?: string | null) => string | undefined;
}

/** The rights of the user in a project (`null`: the shared level). */
export function useAccess(api: Pick<Api, 'accessMe'>, repository: string | null): Access {
  const { t } = useTranslation();
  const [me, setMe] = useState<AccessMe | null>(null);
  useEffect(() => {
    let current = true;
    api.accessMe(repository).then(
      (view) => {
        if (current) setMe(view);
      },
      () => undefined, // no answer: the server still decides
    );
    return () => {
      current = false;
    };
  }, [api, repository]);
  const can = useCallback(
    (action: string, author?: string | null) => allows(me, action, author),
    [me],
  );
  const hint = useCallback(
    (action: string, author?: string | null) =>
      allows(me, action, author) ? undefined : t('access.noRight', { action }),
    [me, t],
  );
  return { can, hint };
}
