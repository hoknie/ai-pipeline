import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { ObserversView } from '../../shared/api/observerTypes.ts';
import type { ObserverTab } from '../../shared/lib/nav/settingsGroups.ts';
import { useConfirm } from '../../shared/ui/overlays/confirm.tsx';
import { ObserverSettingsForm } from './observers/ObserverSettingsForm.tsx';
import { ObserverTabs } from './observers/ObserverTabs.tsx';
import { HistoryTab } from './observers/history/HistoryTab.tsx';

/**
 * The group «Observers» of the shared tab: the switch and limits, the specialist of the observer
 * and the projects it works in. The three tabs edit one form, saved in one go.
 * The fourth tab «History» is an independent read-only screen.
 */
export function ObserversGroup(props: {
  api: Api;
  tab: ObserverTab;
  onTab: (tab: ObserverTab) => void;
  streamed: ObserversView | null;
  repositories: string[];
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [dirty, setDirty] = useState(false);
  const [failingTabs, setFailingTabs] = useState<ObserverTab[]>([]);

  // Stable: the form hook reports through it from an effect, and a new function on every
  // render would report again on every render.
  const parentDirty = useRef(props.onDirty);
  parentDirty.current = props.onDirty;
  const handleDirty = useCallback((value: boolean) => {
    setDirty(value);
    parentDirty.current(value);
  }, []);

  const handleTab = async (nextTab: ObserverTab) => {
    if (props.tab !== 'history' && nextTab === 'history' && dirty) {
      const leaving = await confirm({
        title: t('settings.editor.leaveTitle'),
        description: t('settings.editor.leaveDescription'),
        confirmLabel: t('settings.editor.leave'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      });
      if (!leaving) return;
      handleDirty(false);
    }
    props.onTab(nextTab);
  };

  return (
    <div className="flex flex-col gap-3">
      <ObserverTabs
        tab={props.tab}
        onTab={handleTab}
        tabHasErrors={(tab) => props.tab !== 'history' && failingTabs.includes(tab)}
      />
      {props.tab === 'history' ? (
        <HistoryTab api={props.api} />
      ) : (
        <ObserverSettingsForm
          api={props.api}
          tab={props.tab}
          onTab={handleTab}
          streamed={props.streamed}
          repositories={props.repositories}
          onDirty={handleDirty}
          onErrors={setFailingTabs}
        />
      )}
    </div>
  );
}
