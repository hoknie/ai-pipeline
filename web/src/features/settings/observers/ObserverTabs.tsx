import { useTranslation } from 'react-i18next';

import { OBSERVER_TABS, type ObserverTab } from '../../../shared/lib/nav/settingsGroups.ts';
import { Tabs, TabsList, TabsTrigger } from '../../../shared/ui/layout/tabs.tsx';

/** The observer settings tabs; history is read-only and has no form errors. */
export function ObserverTabs({
  tab,
  onTab,
  tabHasErrors,
}: {
  tab: ObserverTab;
  onTab: (tab: ObserverTab) => void;
  tabHasErrors: (tab: ObserverTab) => boolean;
}) {
  const { t } = useTranslation();
  return (
    <Tabs value={tab} onValueChange={(next) => onTab(next as ObserverTab)}>
      <TabsList aria-label={t('observers.tabs.label')}>
        {OBSERVER_TABS.map((key) => (
          <TabsTrigger key={key} value={key}>
            {t(`observers.tabs.${key}`)}
            {tabHasErrors(key) ? (
              <span className="ml-1 rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">
                !<span className="sr-only">{t('settingsPage.hasErrors')}</span>
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
