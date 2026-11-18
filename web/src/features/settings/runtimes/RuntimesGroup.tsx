import { useTranslation } from 'react-i18next';

import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { SettingsForm } from '../../../shared/ui/forms/settings/SettingsForm.tsx';
import { runtimeSection } from '../../../shared/ui/forms/settings/settingFields.ts';
import { SplitPage } from '../../../shared/ui/layout/EntryList.tsx';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import type { SettingsPageProps } from '../page/types.ts';
import type { SettingsConfig } from '../page/useSettingsConfig.ts';
import { RuntimesOverview } from './RuntimesOverview.tsx';
import { RuntimesSide } from './RuntimesSide.tsx';
import { runtimeRows } from './runtimeRows.ts';

/** The group «Runtimes»: the list on the left, the overview or the form of one runtime. */
export function RuntimesGroup({
  props,
  settings,
}: {
  props: SettingsPageProps;
  settings: SettingsConfig;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { config, failure, reload, setDirty } = settings;
  const { runtime, onSelectRuntime, dirty } = props;
  if (!config) {
    return failure ? null : (
      <div role="status" aria-label={t('settings.editor.loading')}>
        <Skeleton className="h-40" />
      </div>
    );
  }
  const rows = runtimeRows(config);
  const titleOf = (key: string) => t(`settingsPage.section.runtimes_${key}` as never);
  const section = runtime === null ? undefined : runtimeSection(runtime);
  const open = section && rows.some((row) => row.key === section.key) ? section : undefined;
  const go = async (key: string) => {
    if (key === open?.key) return;
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
    dirty.current = false;
    onSelectRuntime(key);
  };
  return (
    <SplitPage
      side={
        <RuntimesSide
          rows={rows}
          selected={open?.key ?? null}
          titleOf={titleOf}
          onOpen={(key) => void go(key)}
        />
      }
    >
      {open ? (
        <SettingsForm
          key={open.key}
          api={props.api}
          config={config}
          scope={props.scope}
          group="runtimes"
          sections={[open]}
          onSaved={reload}
          onDirty={setDirty}
        />
      ) : (
        <RuntimesOverview rows={rows} titleOf={titleOf} onOpen={(key) => void go(key)} />
      )}
    </SplitPage>
  );
}
