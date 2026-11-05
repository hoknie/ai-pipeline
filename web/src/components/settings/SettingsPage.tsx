import { useCallback, useEffect, useMemo, useState, type MouseEvent, type RefObject } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { useConfirm } from '../../confirm.tsx';
import { cn } from '../../lib/cn.ts';
import { repositoryLabel } from '../../repositories.ts';
import { formatRoute } from '../../route.ts';
import {
  SETTINGS_GROUPS_BY_SCOPE,
  SETTINGS_SCOPES,
  errorsByGroup,
  type SettingsGroup,
  type SettingsScope,
} from '../../settingsGroups.ts';
import type { ConfigEditorResponse, QueueView } from '../../types.ts';

import { Alert } from '../../ui/alert.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';

import { ConfigErrors } from '../EntryList.tsx';
import { TagsSettings } from '../TagsSettings.tsx';
import { SharedSpecialistsGroup } from './SharedSpecialistsGroup.tsx';
import { QueueModes } from './QueueModes.tsx';
import { SettingsForm } from './SettingsForm.tsx';
import { SettingsTarget } from './SettingsTarget.tsx';
import { SystemGroup } from './SystemGroup.tsx';

/** Where the state and the restarts of the panel and the daemon are. */
const SYSTEM_LINK = formatRoute({
  view: 'settings',
  run: 'system',
  group: 'global',
  step: null,
  tab: null,
});

const hrefOf = (scope: SettingsScope, group: SettingsGroup) =>
  formatRoute({ view: 'settings', run: group, group: scope, step: null, tab: null });

/**
 * The settings page: tabs «Shared» and «Project», the groups of the tab in the column on the
 * left, the form of the open group beside it.
 */
export default function SettingsPage({
  api,
  scope,
  group,
  specialist,
  onSelectSpecialist,
  repository,
  repositories,
  onSelectRepository,
  queue,
  onQueue,
  onError,
  dirty,
}: {
  api: Api;
  scope: SettingsScope;
  group: SettingsGroup;
  /** The open shared specialist of the group «Specialists» (a slug or `new`); null for none. */
  specialist: string | null;
  onSelectSpecialist: (slug: string | null) => void;
  /** The selected repository; null while none is known. */
  repository: string | null;
  /** The repositories of the panel, the choices of «Project». */
  repositories: string[];
  onSelectRepository: (path: string) => void;
  queue: QueueView | null;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  /** Whether a form has unsaved changes; leaving then asks first. */
  dirty: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [config, setConfig] = useState<ConfigEditorResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setConfig(await api.config());
    setFailure(null);
  }, [api]);
  useEffect(() => {
    reload().catch((error: Error) => setFailure(error.message));
  }, [reload]);
  const setDirty = useCallback(
    (value: boolean) => {
      dirty.current = value;
    },
    [dirty],
  );

  const errors = useMemo(() => errorsByGroup(config?.errors ?? []), [config]);
  const groups = SETTINGS_GROUPS_BY_SCOPE[scope];

  /** A link that leaves the form: with unsaved changes it asks first. */
  const leave = (href: string) => async (event: MouseEvent) => {
    if (!dirty.current) return;
    event.preventDefault();
    const leaving = await confirm({
      title: t('settings.editor.leaveTitle'),
      description: t('settings.editor.leaveDescription'),
      confirmLabel: t('settings.editor.leave'),
      cancelLabel: t('settings.editor.stay'),
      destructive: true,
    });
    if (!leaving) return;
    dirty.current = false;
    window.location.hash = href;
  };

  const tabGroup = (target: SettingsScope): SettingsGroup =>
    (SETTINGS_GROUPS_BY_SCOPE[target] as readonly string[]).includes(group) ? group : 'general';
  const file = config?.settingsFiles[scope].file ?? null;
  const noProjects = scope === 'project' && repositories.length === 0;
  const isForm = group !== 'tags' && group !== 'queue' && group !== 'specialists';
  const sharedDirectory = config ? `${config.directories.global}/specialists` : null;

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <div className="border-b">
        <div role="tablist" aria-label={t('settingsPage.tabs')} className="flex gap-1">
          {SETTINGS_SCOPES.map((tab) => (
            <a
              key={tab}
              role="tab"
              aria-selected={tab === scope}
              href={hrefOf(tab, tabGroup(tab))}
              onClick={leave(hrefOf(tab, tabGroup(tab)))}
              className={cn(
                '-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground',
                tab === scope && 'border-primary text-foreground',
              )}
            >
              {t(`settingsPage.scope.${tab}`)}
            </a>
          ))}
        </div>
      </div>
      <SettingsTarget
        scope={scope}
        repository={repository}
        repositories={repositories}
        onSelectRepository={onSelectRepository}
        file={group === 'specialists' ? sharedDirectory : isForm ? file : null}
      />
      {noProjects ? null : (
        <div className="grid w-full gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
          <nav aria-label={t('settingsPage.groups')}>
            <ul className="flex flex-wrap gap-1 lg:flex-col">
              {groups.map((key) => (
                <li key={key}>
                  <a
                    href={hrefOf(scope, key)}
                    onClick={leave(hrefOf(scope, key))}
                    aria-current={key === group ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-sm font-medium hover:bg-accent',
                      key === group && 'border-border bg-accent',
                    )}
                  >
                    {t(`settingsPage.group.${key}`)}
                    {errors.has(key) ? (
                      <span
                        className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground"
                        title={t('settingsPage.hasErrors')}
                      >
                        !<span className="sr-only">{t('settingsPage.hasErrors')}</span>
                      </span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-col gap-3" data-group={group} data-scope={scope}>
            <h2 className="text-lg font-semibold">{t(`settingsPage.group.${group}`)}</h2>
            <p className="text-sm text-muted-foreground">{t(`settingsPage.about.${group}`)}</p>
            {group === 'runtimes' || group === 'system' ? (
              <p className="text-sm text-muted-foreground">
                <Trans
                  i18nKey="settingsPage.restartNote"
                  components={{ link: <a className="underline" href={SYSTEM_LINK} /> }}
                />
              </p>
            ) : null}
            {failure ? <Alert variant="destructive">{failure}</Alert> : null}
            {group !== 'tags' && config ? <ConfigErrors errors={errors.get(group) ?? []} /> : null}
            {group === 'tags' ? (
              repository === null ? null : (
                <TagsSettings api={api} repository={repository} />
              )
            ) : group === 'queue' ? (
              queue ? (
                <QueueModes
                  api={api}
                  queue={queue}
                  repositoryName={repository === null ? null : repositoryLabel(repository)}
                  config={config}
                  onReload={reload}
                  onQueue={onQueue}
                  onError={onError}
                />
              ) : (
                <div role="status" aria-label={t('queue.loading')}>
                  <Skeleton className="h-24" />
                </div>
              )
            ) : group === 'specialists' ? (
              config ? (
                <SharedSpecialistsGroup
                  api={api}
                  config={config}
                  selected={specialist}
                  onSelect={onSelectSpecialist}
                  onReload={reload}
                  dirty={dirty}
                />
              ) : failure ? null : (
                <div role="status" aria-label={t('settings.editor.loading')}>
                  <Skeleton className="h-40" />
                </div>
              )
            ) : (
              <>
                {config ? (
                  <SettingsForm
                    key={`${scope}/${group}`}
                    api={api}
                    config={config}
                    scope={scope}
                    group={group}
                    onSaved={reload}
                    onDirty={setDirty}
                  />
                ) : failure ? null : (
                  <div role="status" aria-label={t('settings.editor.loading')}>
                    <Skeleton className="h-40" />
                  </div>
                )}
                {group === 'system' ? (
                  <SystemGroup api={api} onRestarted={() => void reload().catch(() => undefined)} />
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
