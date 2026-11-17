import { useTranslation } from 'react-i18next';

import { LinkTabs } from '../../shared/ui/layout/LinkTabs.tsx';
import { useConfirm } from '../../shared/ui/overlays/confirm.tsx';
import { recalledSwarm } from './memory.ts';
import { SWARM_TABS, type SwarmScope, type SwarmTarget } from './types/tabs.ts';

/** The row of the tabs of the window; a click asks first when the open form has edits. */
export function SwarmTabs({
  scope,
  place,
  dirty,
  hrefOf,
  onNavigate,
}: {
  scope: SwarmScope;
  place: SwarmTarget;
  dirty: { current: boolean };
  hrefOf: (target: SwarmTarget) => string;
  onNavigate: (target: SwarmTarget) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  return (
    <LinkTabs
      label={t('swarm.tabs.label')}
      tabs={SWARM_TABS.map((key) => {
        const current = key === place.tab;
        // the open tab leads back to its list; another tab to the entry last open there
        const target: SwarmTarget = current ? { tab: key, entry: null } : recalledSwarm(scope, key);
        const inside = current && (place.entry !== null || !!place.section || !!place.variant);
        return {
          key,
          label: t(`swarm.tabs.${key}`),
          href: hrefOf(target),
          selected: current,
          onClick: async (event) => {
            event.preventDefault();
            if (current && !inside) return;
            if (dirty.current) {
              const leave = await confirm({
                title: t('settings.editor.leaveTitle'),
                description: t('settings.editor.leaveDescription'),
                confirmLabel: t('settings.editor.leave'),
                cancelLabel: t('settings.editor.stay'),
                destructive: true,
              });
              if (!leave) return;
              dirty.current = false;
            }
            onNavigate(target);
          },
        };
      })}
    />
  );
}
