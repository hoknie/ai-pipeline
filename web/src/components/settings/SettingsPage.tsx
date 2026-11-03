import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { cn } from '../../lib/cn.ts';
import { repositoryLabel } from '../../repositories.ts';
import { formatRoute } from '../../route.ts';
import {
  SETTINGS_GROUPS,
  errorsByGroup,
  groupOf,
  type SettingsGroup as GroupKey,
} from '../../settingsGroups.ts';
import type { ConfigEditorResponse, QueueView } from '../../types.ts';

import { Alert } from '../../ui/alert.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';

import { ConfigErrors } from '../EntryList.tsx';
import { TagsSettings } from '../TagsSettings.tsx';
import { DeliveryFields } from './DeliveryFields.tsx';
import { QueueModes } from './QueueModes.tsx';
import { SettingsFields } from './SettingsGroup.tsx';
import { SystemGroup } from './SystemGroup.tsx';

/** Where the state and the restarts of the panel and the daemon are. */
const SYSTEM_LINK = formatRoute({ view: 'settings', run: 'system', group: null, step: null });

/** The settings page: groups in the column on the left, the fields of the open group beside it. */
export default function SettingsPage({
  api,
  group,
  repository,
  queue,
  onQueue,
  onError,
}: {
  api: Api;
  group: GroupKey;
  /** The selected repository; null while none is known. */
  repository: string | null;
  queue: QueueView | null;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ConfigEditorResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setConfig(await api.config());
    setFailure(null);
  }, [api]);
  useEffect(() => {
    reload().catch((error: Error) => setFailure(error.message));
  }, [reload]);

  const errors = useMemo(() => errorsByGroup(config?.errors ?? []), [config]);
  const fields = (config?.settings ?? []).filter((setting) => groupOf(setting.path) === group);

  return (
    <div className="grid w-full gap-4 p-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
      <nav aria-label={t('settingsPage.groups')}>
        <ul className="flex flex-wrap gap-1 lg:flex-col">
          {SETTINGS_GROUPS.map((key) => (
            <li key={key}>
              <a
                href={formatRoute({ view: 'settings', run: key, group: null, step: null })}
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
      <div className="flex min-w-0 flex-col gap-3" data-group={group}>
        <h2 className="text-lg font-semibold">{t(`settingsPage.group.${group}`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`settingsPage.about.${group}`)}</p>
        {group === 'runtimes' || group === 'web' ? (
          <p className="text-sm text-muted-foreground">
            <Trans
              i18nKey="settingsPage.restartNote"
              components={{ link: <a className="underline" href={SYSTEM_LINK} /> }}
            />
          </p>
        ) : null}
        {group !== 'system' && failure ? <Alert variant="destructive">{failure}</Alert> : null}
        {group !== 'system' && group !== 'tags' && config ? (
          <ConfigErrors errors={errors.get(group) ?? []} />
        ) : null}
        {group === 'system' ? (
          <SystemGroup api={api} onRestarted={() => void reload().catch(() => undefined)} />
        ) : group === 'tags' ? (
          <TagsSettings api={api} />
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
        ) : !config ? (
          failure ? null : (
            <div role="status" aria-label={t('settings.editor.loading')}>
              <Skeleton className="h-40" />
            </div>
          )
        ) : (
          <>
            {group === 'delivery' ? (
              <div className="flex max-w-xl flex-col gap-3 rounded-xl border bg-card p-3">
                <DeliveryFields api={api} config={config} onReload={reload} idPrefix="settings" />
              </div>
            ) : null}
            <SettingsFields
              settings={
                group === 'delivery'
                  ? fields.filter((s) => s.path !== 'delivery.auto' && s.path !== 'delivery.mode')
                  : fields
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
