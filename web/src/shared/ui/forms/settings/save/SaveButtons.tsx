import { useTranslation } from 'react-i18next';

import type { Api } from '../../../../api/api.ts';
import { useAccess } from '../../../../lib/access/useAccess.ts';
import type { SettingsScope } from '../../../../lib/nav/settingsGroups.ts';
import { Button } from '../../button.tsx';
import type { useSettingsDraft } from '../useSettingsDraft.ts';

/** Whether the user may write the settings of the scope, and the hint when not. */
export function useWriteAccess(api: Api, scope: SettingsScope) {
  const access = useAccess(api, api.repository ?? null);
  const action = scope === 'global' ? 'config.global.write' : 'config.write';
  return { allowed: access.can(action), hint: access.hint(action) };
}

/** «Save» and «Discard» of the settings form; «Save» is off for a user without the right. */
export function SaveButtons({
  draft,
  write,
}: {
  draft: ReturnType<typeof useSettingsDraft>;
  write: ReturnType<typeof useWriteAccess>;
}) {
  const { t } = useTranslation();
  const { dirty, busy } = draft;
  return (
    <div className="flex gap-2">
      <Button
        type="submit"
        disabled={!dirty || busy || !write.allowed}
        title={write.hint}
        loading={busy}
      >
        {t('settingsPage.save')}
      </Button>
      <Button type="button" variant="outline" disabled={!dirty || busy} onClick={draft.discard}>
        {t('settingsPage.discard')}
      </Button>
    </div>
  );
}
