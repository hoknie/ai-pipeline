import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import type { SystemKind, SystemStageEntry, SystemStagesResponse } from '../pipelineEntries.ts';
import { formatRoute } from '../route.ts';
import { SETTINGS_SCOPES, type SettingsScope } from '../settingsGroups.ts';
import { Alert } from '../ui/alert.tsx';
import { Label } from '../ui/label.tsx';
import { Textarea } from '../ui/textarea.tsx';
import type { ConfigEditorResponse, WriteLevel } from '../types.ts';

import { FilePath } from './FilePath.tsx';
import { LinkTabs } from './LinkTabs.tsx';
import { SettingsForm } from './settings/SettingsForm.tsx';
import { STAGE_SECTIONS } from './settings/settingFields.ts';

/** The level a stage is shown at: the project when it sets any of its settings, else the shared. */
export function stageLevel(stage: SystemStageEntry | undefined): WriteLevel {
  return stage?.settings.some((setting) => setting.level === 'project') ? 'project' : 'global';
}

export function SystemStagePage({
  api,
  kind,
  view,
  stages,
  failure,
  scope,
  onScope,
  onDirty,
  onReload,
}: {
  api: Api;
  kind: SystemKind;
  view: ConfigEditorResponse;
  /** null while the stages are not loaded or could not be. */
  stages: SystemStagesResponse | null;
  failure: string | null;
  /** The open level tab: «Shared» (`global`) or «Project». */
  scope: SettingsScope;
  onScope: (scope: SettingsScope) => void;
  onDirty: (dirty: boolean) => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const stage = stages?.stages.find((candidate) => candidate.kind === kind);
  const performer = stage?.name ?? t(`pipeline.system.kinds.${kind}`);

  return (
    <section className="flex flex-col gap-3" aria-label={t('pipeline.system.section', { kind })}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t(`pipeline.system.kinds.${kind}`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`pipeline.system.hints.${kind}`)}</p>
      </div>
      {failure ? (
        <Alert variant="destructive">{t('pipeline.system.loadFailed', { message: failure })}</Alert>
      ) : null}
      {stages && stages.errors.length > 0 ? (
        <Alert variant="destructive">
          <ul>
            {stages.errors.map((error) => (
              <li key={`${error.file ?? ''}:${error.path}:${error.message}`}>
                <code>{error.path}</code>: {error.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="system-task">{t('pipeline.system.task')}</Label>
        {stage?.task ? (
          <Textarea
            id="system-task"
            readOnly
            rows={12}
            className="font-mono text-xs"
            value={stage.task}
            aria-label={t('pipeline.system.taskLabel', { name: performer })}
          />
        ) : (
          <p id="system-task" className="text-sm text-muted-foreground">
            {t('pipeline.system.noTask')}
          </p>
        )}
        {stage?.task ? (
          <p className="text-xs text-muted-foreground">{t('pipeline.system.taskHelp')}</p>
        ) : null}
      </div>

      {kind !== 'split' ? (
        <div className="flex flex-col gap-3">
          <LinkTabs
            label={t('settingsPage.tabs')}
            tabs={SETTINGS_SCOPES.map((tab) => ({
              key: tab,
              label: t(`settingsPage.scope.${tab}`),
              href: formatRoute({
                view: 'pipelines',
                run: kind,
                group: 'system',
                step: tab === 'global' ? 'global' : null,
                tab: null,
              }),
              selected: tab === scope,
              onClick: (event) => {
                event.preventDefault();
                onScope(tab);
              },
            }))}
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{t('settingsPage.writesTo')}</span>
            <FilePath path={view.settingsFiles[scope].file} variant="line" />
            {scope === 'global' ? (
              <span className="text-xs text-muted-foreground">{t('settingsPage.globalNote')}</span>
            ) : null}
          </div>
          <SettingsForm
            key={`${kind}:${scope}`}
            api={api}
            config={view}
            scope={scope}
            group="delivery"
            sections={STAGE_SECTIONS[kind]}
            onSaved={onReload}
            onDirty={onDirty}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('pipeline.system.splitSettings')}</p>
      )}
    </section>
  );
}
