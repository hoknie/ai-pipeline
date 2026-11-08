import { Trans, useTranslation } from 'react-i18next';

import { LinkTabs } from '../../shared/ui/layout/LinkTabs.tsx';
import {
  BETA_SETTINGS_GROUPS,
  SETTINGS_GROUPS_BY_SCOPE,
  SETTINGS_SCOPES,
  errorsByGroup,
  type SettingsGroup,
  type SettingsScope,
} from '../../shared/lib/nav/settingsGroups.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { ConfigErrors } from '../../shared/ui/layout/EntryList.tsx';
import { SettingsTarget } from './SettingsTarget.tsx';
import { BetaBadge } from './page/BetaBadge.tsx';
import { GroupBody } from './page/GroupBody.tsx';
import { GroupNav } from './page/GroupNav.tsx';
import { hrefOf, SYSTEM_LINK } from './page/hrefOf.ts';
import type { SettingsPageProps } from './page/types.ts';
import { useSettingsConfig } from './page/useSettingsConfig.ts';

/** The directory or file a group edits, shown above the groups. */
function targetOf(
  props: SettingsPageProps,
  config: ReturnType<typeof useSettingsConfig>['config'],
): string | null {
  const { group, scope } = props;
  if (group === 'specialists' || group === 'pipelines') {
    return config ? `${config.directories.global}/${group}` : null;
  }
  const isForm = group !== 'tags' && group !== 'queue' && group !== 'observers';
  return isForm ? (config?.settingsFiles[scope].file ?? null) : null;
}

/**
 * The settings page: tabs «Shared» and «Project», the groups of the tab in the column on the
 * left, the form of the open group beside it.
 */
export default function SettingsPage(props: SettingsPageProps) {
  const { t } = useTranslation();
  const { scope, group, repository, repositories } = props;
  const settings = useSettingsConfig(props.api, props.dirty);
  const { config, failure, leave } = settings;
  const errors = errorsByGroup(config?.errors ?? []);
  const tabGroup = (target: SettingsScope): SettingsGroup =>
    (SETTINGS_GROUPS_BY_SCOPE[target] as readonly string[]).includes(group) ? group : 'general';
  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <LinkTabs
        label={t('settingsPage.tabs')}
        tabs={SETTINGS_SCOPES.map((tab) => ({
          key: tab,
          label: t(`settingsPage.scope.${tab}`),
          href: hrefOf(tab, tabGroup(tab)),
          selected: tab === scope,
          onClick: leave(hrefOf(tab, tabGroup(tab))),
        }))}
      />
      <SettingsTarget
        scope={scope}
        repository={repository}
        repositories={repositories}
        onSelectRepository={props.onSelectRepository}
        file={targetOf(props, config)}
      />
      {scope === 'project' && repositories.length === 0 ? null : (
        <div className="grid w-full gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
          <GroupNav
            groups={SETTINGS_GROUPS_BY_SCOPE[scope]}
            scope={scope}
            group={group}
            errors={errors}
            leave={leave}
          />
          <div className="flex min-w-0 flex-col gap-3" data-group={group} data-scope={scope}>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {t(`settingsPage.group.${group}`)}
              {BETA_SETTINGS_GROUPS.has(group) ? <BetaBadge /> : null}
            </h2>
            <p className="text-sm text-muted-foreground">{t(`settingsPage.about.${group}`)}</p>
            {group === 'runtimes' ? (
              <p className="text-sm text-muted-foreground">{t('settingsPage.runtimeNote')}</p>
            ) : group === 'system' ? (
              <p className="text-sm text-muted-foreground">
                <Trans
                  i18nKey="settingsPage.restartNote"
                  components={{ link: <a className="underline" href={SYSTEM_LINK} /> }}
                />
              </p>
            ) : null}
            {failure ? <Alert variant="destructive">{failure}</Alert> : null}
            {group !== 'tags' && config ? <ConfigErrors errors={errors.get(group) ?? []} /> : null}
            <GroupBody props={props} settings={settings} />
          </div>
        </div>
      )}
    </div>
  );
}
