import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addedProject,
  latestEnabled,
  repositoryLabel,
} from '../../shared/lib/catalog/repositories.ts';
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
  /** Makes a repository the panel's; false when the user stays with unsaved edits. */
  const selectRepository = async (path: string): Promise<boolean> => {
    if (path === selected) return true;
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
      return false;
    reset();
    setChosen(path);
    // A run of the previous repository cannot stay open: the list is about to show another.
    if (route.view === 'runs') setRoute(closedRuns);
    return true;
  };

  const addRepository = async (path: string) => {
    const list = await api.addRepository(path);
    setRegistry(list);
    const root = addedProject(path, registry, list)?.path;
    if (root) await selectRepository(root);
  };

  const removeRepository = async (path: string): Promise<boolean> => {
    const name = repositoryLabel(path);
    if (
      !(await confirm({
        title: t('nav.repositoryRemoveTitle', { name }),
        description: t('nav.repositoryRemoveDescription'),
        confirmLabel: t('nav.repositoryRemove'),
        destructive: true,
      }))
    )
      return false;
    let list;
    try {
      list = await api.removeRepository(path);
    } catch (error) {
      notifyError(error);
      return false;
    }
    setRegistry(list);
    if (path === latest.current.selected || path === latest.current.chosen) {
      reset();
      // without a known home the panel would be left with no repository and no list
      setChosen(panel.state.home === null ? latestEnabled(list) : null);
      if (route.view === 'runs') setRoute(closedRuns);
    }
    return true;
  };

  /** A project moved: the chosen repository follows it to the new path. */
  const projectMoved = (from: string, to: string) => {
    if (latest.current.chosen === from || latest.current.selected === from) setChosen(to);
  };

  /** Makes a project the panel's repository, then opens its settings or its queue. */
  const openProject = async (path: string, target: 'settings' | 'queue') => {
    if (!(await selectRepository(path))) return;
    setRoute(
      target === 'queue'
        ? { view: 'queue', run: null, group: null, step: null, tab: null }
        : { view: 'settings', run: 'general', group: 'project', step: null, tab: null },
    );
  };
  return { selectRepository, addRepository, removeRepository, projectMoved, openProject };
}
