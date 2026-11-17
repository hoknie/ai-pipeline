import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { useHotkey } from '../../../shared/lib/browser/hotkeys.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { editFailure } from '../matrix/useCellWrite.ts';
import { invalidateProviders } from '../page/useProviderRegistry.ts';
import {
  addRole,
  canMove,
  movableRoles,
  moveRole,
  removeRole,
  renameRole,
  roleRecordOf,
  type RoleRecord,
} from './edit.ts';
import { holdersOf } from './removal.ts';

export type Level = 'global' | 'project';
export type RoleDialog = { kind: 'add' } | { kind: 'rename' | 'remove'; slug: string } | null;

/** `Alt+↑` and `Alt+↓` move the selected role. */
function useMoveHotkeys(selected: string | null, move: (slug: string, step: -1 | 1) => void) {
  useHotkey('Alt+ArrowUp', (event) => {
    if (selected === null) return;
    event.preventDefault();
    move(selected, -1);
  });
  useHotkey('Alt+ArrowDown', (event) => {
    if (selected === null) return;
    event.preventDefault();
    move(selected, 1);
  });
}

/**
 * The actions of the tab «Roles» on the roles of one level: every one writes `roles` of that
 * settings file whole. Removing asks first, and a role with models goes through the clearing dialog.
 */
export function useRoleActions(options: {
  api: Api;
  repository: string | null;
  view: ProvidersView;
  editor: ConfigEditorResponse | null;
  level: Level;
}) {
  const { api, repository, view, editor, level } = options;
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RoleDialog>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const setting = editor?.settings.find((item) => item.path === 'roles');
  const written: Record<Level, RoleRecord> = {
    global: roleRecordOf(setting?.written.global),
    project: roleRecordOf(setting?.written.project),
  };
  const record = written[level];
  const movable = movableRoles(level, record, written.global);

  /** Writes the roles of the level; resolves to the error text, or null once accepted. */
  const save = async (next: RoleRecord): Promise<string | null> => {
    try {
      const empty = Object.keys(next).length === 0;
      const revision = editor?.settingsFiles[level].revision ?? null;
      const result = await api.writeSetting('roles', empty ? null : next, revision, level);
      await invalidateProviders(repository);
      return result.ok ? null : editFailure(result);
    } catch (error) {
      return (error as Error).message;
    }
  };
  const apply = async (next: RoleRecord) => {
    const error = await save(next);
    setFailure(error);
    if (error === null) setDialog(null);
  };
  const move = (slug: string, step: -1 | 1) => {
    if (editor && canMove(movable, slug, step)) void apply(moveRole(record, movable, slug, step));
  };
  useMoveHotkeys(selected, move);

  const askRemove = async (slug: string, name: string) => {
    if (!editor) return;
    const overriding = level === 'project' && slug in written.global;
    if (!overriding && holdersOf(view.providers, slug).length > 0) {
      return setDialog({ kind: 'remove', slug });
    }
    const ok = await confirm({
      title: t('providers.roles.removeTitle', { name }),
      description: overriding
        ? t('providers.roles.removeOverride')
        : t('providers.roles.removeEmpty'),
      confirmLabel: t('providers.roles.remove'),
      destructive: true,
    });
    if (ok) setFailure(await save(removeRole(record, slug)));
  };
  return {
    record,
    movable,
    selected,
    select: setSelected,
    dialog,
    setDialog,
    failure,
    save,
    apply,
    move,
    askRemove,
    add: (slug: string, name: string) => void apply(addRole(record, slug, name)),
    rename: (slug: string, name: string) => void apply(renameRole(record, slug, name)),
  };
}
