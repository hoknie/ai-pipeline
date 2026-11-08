import { useTranslation } from 'react-i18next';

import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';

/** Chooses another entry; asks first when the open form has edits. */
export function useLeaveGuard(
  selected: string | null,
  dirty: { current: boolean },
  onSelect: (id: string | null, extra?: string | null) => void,
  onLeft: () => void,
): (id: string | null, extra?: string | null) => Promise<void> {
  const { t } = useTranslation();
  const confirm = useConfirm();
  return async (id, extra) => {
    if (id === selected && extra === undefined) return;
    const leave =
      !dirty.current ||
      (await confirm({
        title: t('settings.editor.leaveTitle'),
        description: t('settings.editor.leaveDescription'),
        confirmLabel: t('settings.editor.leave'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      }));
    if (!leave) return;
    dirty.current = false;
    onLeft();
    onSelect(id, extra);
  };
}
