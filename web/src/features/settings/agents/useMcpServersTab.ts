import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditResult } from '../../../shared/api/types.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import type { McpFormMode } from './useMcpServerForm.ts';

export type OpenForm = { mode: McpFormMode; name: string | null } | null;

/**
 * What the tab of the catalog does around the form: which form is open, leaving a form with
 * unsaved changes, and deleting (or restoring) a server after a question.
 */
export function useMcpServersTab(
  remove: (name: string) => Promise<ConfigEditResult>,
  onDirty: (dirty: boolean) => void,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [open, setOpen] = useState<OpenForm>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const formDirty = useRef(false);
  const handleDirty = useCallback(
    (dirty: boolean) => {
      formDirty.current = dirty;
      onDirty(dirty);
    },
    [onDirty],
  );

  /** Opens another form; unsaved changes of the open one are given up only after a question. */
  const guarded = async (next: OpenForm) => {
    if (formDirty.current) {
      const leaving = await confirm({
        title: t('settings.editor.leaveTitle'),
        description: t('settings.editor.leaveDescription'),
        confirmLabel: t('settings.editor.leave'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      });
      if (!leaving) return;
    }
    handleDirty(false);
    setFailure(null);
    setOpen(next);
  };

  const close = () => {
    setFailure(null);
    setOpen(null);
  };

  const removeServer = async (name: string, restore: boolean) => {
    const sure = await confirm({
      title: t(restore ? 'settingsPage.mcp.restoreTitle' : 'settingsPage.mcp.deleteTitle', {
        name,
      }),
      description: t(
        restore ? 'settingsPage.mcp.restoreDescription' : 'settingsPage.mcp.deleteDescription',
      ),
      confirmLabel: t(restore ? 'settingsPage.mcp.restore' : 'settingsPage.mcp.delete'),
      destructive: !restore,
    });
    if (!sure) return;
    const result = await remove(name);
    if (result.ok) {
      setFailure(null);
      setOpen(null);
    } else if (result.reason === 'conflict') setFailure(result.message);
    else setFailure(result.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
  };

  return { open, close, failure, guarded, removeServer, handleDirty };
}
