import { useCallback, useEffect, useState, type MouseEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';

/** The config the forms edit, its reload, the dirty flag and the guarded leaving of a form. */
export function useSettingsConfig(api: Api, dirty: RefObject<boolean>) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [config, setConfig] = useState<ConfigEditorResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setConfig(await api.config());
    setFailure(null);
  }, [api]);
  useEffect(() => {
    reload().catch((error: Error) => setFailure(error.message));
  }, [reload]);
  const setDirty = useCallback(
    (value: boolean) => {
      dirty.current = value;
    },
    [dirty],
  );
  /** A link that leaves the form: with unsaved changes it asks first. */
  const leave = (href: string) => async (event: MouseEvent) => {
    if (!dirty.current) return;
    event.preventDefault();
    const leaving = await confirm({
      title: t('settings.editor.leaveTitle'),
      description: t('settings.editor.leaveDescription'),
      confirmLabel: t('settings.editor.leave'),
      cancelLabel: t('settings.editor.stay'),
      destructive: true,
    });
    if (!leaving) return;
    dirty.current = false;
    window.location.hash = href;
  };
  return { config, failure, reload, setDirty, leave };
}

export type SettingsConfig = ReturnType<typeof useSettingsConfig>;
