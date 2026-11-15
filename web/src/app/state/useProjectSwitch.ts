import { useTranslation } from 'react-i18next';

import type { Route } from '../../shared/lib/nav/route.ts';
import { useConfirm } from '../../shared/ui/overlays/confirm.tsx';
import type { PanelData } from './usePanelData.ts';

const closedRuns: Route = { view: 'runs', run: null, group: null, step: null, tab: null };

/** Choosing the project of the panel or the mode «All projects», asking before edits are dropped. */
export function useProjectSwitch(panel: PanelData, reset: () => void) {
  const { route, setRoute, setChosen } = panel;
  const { selected } = panel.state;
  const { dirty } = panel.chrome;
  const { t } = useTranslation();
  const confirm = useConfirm();
  const leaveEdits = async (): Promise<boolean> =>
    !dirty.current ||
    (await confirm({
      title: t('settings.editor.leaveTitle'),
      description: t('settings.editor.leaveDescription'),
      confirmLabel: t('settings.editor.leave'),
      cancelLabel: t('settings.editor.stay'),
      destructive: true,
    }));
  /** Turns the mode «All projects» on; false when the user stays with unsaved edits. */
  const selectAllProjects = async (): Promise<boolean> => {
    if (panel.allProjects) return true;
    if (!(await leaveEdits())) return false;
    reset();
    panel.setAllProjects(true);
    return true;
  };
  /** Makes a repository the panel's; `keepMode` leaves the mode «All projects» as it is. */
  const chooseRepository = async (path: string, keepMode: boolean): Promise<boolean> => {
    // choosing the selected project still leaves the mode «All projects»
    if (path === selected && (keepMode || !panel.allProjects)) return true;
    if (!(await leaveEdits())) return false;
    reset();
    if (keepMode) {
      panel.rememberProject(path);
      return true;
    }
    setChosen(path);
    // A run of the previous repository cannot stay open: the list is about to show another.
    if (route.view === 'runs') setRoute(closedRuns);
    return true;
  };
  const selectRepository = (path: string) => chooseRepository(path, false);
  /** Changes the last chosen project, the one of the settings, and stays in the mode. */
  const switchProject = (path: string) => chooseRepository(path, true);

  return { selectAllProjects, selectRepository, switchProject };
}
