import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import {
  AGENT_TABS,
  type AgentTab,
  type SettingsScope,
} from '../../../shared/lib/nav/settingsGroups.ts';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { LinkTabs } from '../../../shared/ui/layout/LinkTabs.tsx';
import { McpServersTab } from './McpServersTab.tsx';

const hrefOf = (scope: SettingsScope, tab: AgentTab) =>
  formatRoute({ view: 'settings', run: 'agents', group: scope, step: tab, tab: null });

/**
 * The group «Agents»: the tab «Main» holds the former forms of the group (`children`), the tab
 * «MCP servers» the catalog of MCP servers of the level of the page tab. The tabs are addresses;
 * leaving a form with unsaved changes asks first.
 */
export function AgentsGroup({
  api,
  scope,
  tab,
  config,
  reload,
  leave,
  onDirty,
  children,
}: {
  api: Api;
  scope: SettingsScope;
  tab: AgentTab;
  config: ConfigEditorResponse | null;
  reload: () => Promise<void>;
  leave: (href: string) => (event: MouseEvent) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <LinkTabs
        label={t('settingsPage.agentTabs.label')}
        tabs={AGENT_TABS.map((key) => ({
          key,
          label: t(`settingsPage.agentTabs.${key}`),
          href: hrefOf(scope, key),
          selected: key === tab,
          onClick: (event) => void leave(hrefOf(scope, key))(event),
        }))}
      />
      {tab === 'general' ? (
        children
      ) : config ? (
        <McpServersTab
          key={scope}
          api={api}
          scope={scope}
          config={config}
          reload={reload}
          onDirty={onDirty}
        />
      ) : (
        <Skeleton className="h-24" />
      )}
    </div>
  );
}
