import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import { notifyError } from '../../shared/lib/browser/notify.ts';
import type { Route } from '../../shared/lib/nav/route.ts';
import type { PanelData } from './usePanelData.ts';
import { useConfirm } from '../../shared/ui/overlays/confirm.tsx';

const closedRuns: Route = { view: 'runs', run: null, group: null, step: null, tab: null };

/** Switching, adding and removing repositories, asking before unsaved edits are dropped. */
export function useRepositoryActions(panel: PanelData) {
  const { api, route, setRoute, chosen, setChosen, lastRun } = panel;
  const { selected, registry, setRegistry } = panel.state;
  const { dirty } = panel.chrome;
  const { t } = useTranslation();
  const confirm = useConfirm();
  const latest = useRef({ chosen, selected });
  latest.current = { chosen, selected };

  const reset = () => {
    dirty.current = false;
    lastRun.current = null;
  };
  const selectRepository = async (path: string) => {
    if (path === selected) return;
    if (
      dirty.current &&
      !(await confirm({
        title: t('settings.editor.leaveTitle'),
        description: t('settings.editor.leaveDescription'),
        confirmLabel: t('settings.editor.leave'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      }))
    )
      return;
    reset();
    setChosen(path);
    // A run of the previous repository cannot stay open: the list is about to show another.
    if (route.view === 'runs') setRoute(closedRuns);
  };

  const addRepository = async (path: string) => {
    const list = await api.addRepository(path);
    setRegistry(list);
    // The daemon answers with the list only; the new entry is the root that contains the path.
    const known = new Set(registry.map((entry) => entry.path));
    const root =
      list
        .filter((entry) => path === entry.path || path.startsWith(`${entry.path}/`))
        .sort((left, right) => right.path.length - left.path.length)[0]?.path ??
      list.find((entry) => !known.has(entry.path))?.path;
    if (root) await selectRepository(root);
  };

  const removeRepository = async (path: string) => {
    const name = repositoryLabel(path);
    if (
      !(await confirm({
        title: t('nav.repositoryRemoveTitle', { name }),
        description: t('nav.repositoryRemoveDescription'),
        confirmLabel: t('nav.repositoryRemove'),
        destructive: true,
      }))
    )
      return;
    try {
      setRegistry(await api.removeRepository(path));
    } catch (error) {
      notifyError(error);
      return;
    }
    if (path === latest.current.selected || path === latest.current.chosen) {
      reset();
      setChosen(null);
      if (route.view === 'runs') setRoute(closedRuns);
    }
  };
  return { selectRepository, addRepository, removeRepository };
}
