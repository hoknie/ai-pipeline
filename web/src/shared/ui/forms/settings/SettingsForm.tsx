import { useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../api/api.ts';
import type { ConfigEditorResponse, EditorSetting, RepositoryView } from '../../../api/types.ts';
import type { SettingsGroup, SettingsScope } from '../../../lib/nav/settingsGroups.ts';

import { ModelCatalogProvider } from '../../../lib/catalog/models.tsx';
import { Alert } from '../../feedback/alert.tsx';
import { Button } from '../button.tsx';
import { Card } from '../../layout/card.tsx';

import { EnvEditor } from './EnvEditor.tsx';
import { INHERIT, SettingField, savedValue } from './SettingField.tsx';
import { SETTINGS_SECTIONS, type SettingsSection } from './settingFields.ts';
import { specialistOptions, type SpecialistOption } from '../../../lib/specialistLabels.ts';
import { useSettingsDraft } from './useSettingsDraft.ts';

type Draft = ReturnType<typeof useSettingsDraft>;

function FormAlerts({ draft, onReload }: { draft: Draft; onReload: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      {draft.conflict ? (
        <Alert variant="destructive" className="flex flex-wrap items-center gap-2">
          <span>{t('settingsPage.conflict', { message: draft.conflict })}</span>
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
            {t('settingsPage.reload')}
          </Button>
        </Alert>
      ) : null}
      {draft.failure ? <Alert variant="destructive">{draft.failure}</Alert> : null}
      {draft.others.length > 0 ? (
        <Alert variant="destructive">
          <ul>
            {draft.others.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </>
  );
}

/** What the «Statistics» card does, and the way to the page. */
function StatsNote() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p>{t('settingsPage.statsNote.exclude')}</p>
      <p>{t('settingsPage.statsNote.disabled')}</p>
      <p>{t('settingsPage.statsNote.live')}</p>
      <a href="#stats" className="w-fit text-primary underline underline-offset-2">
        {t('settingsPage.statsNote.open')}
      </a>
    </div>
  );
}

function SectionCard({
  id,
  title,
  mark,
  children,
}: {
  id: string;
  title: string;
  mark?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Card>
      <section aria-labelledby={id} className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline gap-2">
          <h3 id={id} className="text-sm font-semibold">
            {title}
          </h3>
          {mark ? <span className="text-xs text-muted-foreground">({mark})</span> : null}
        </div>
        {children}
      </section>
    </Card>
  );
}

/** One card of a group, or nothing when none of its fields is known. */
function SectionCards({
  section,
  group,
  byPath,
  fields: shared,
}: {
  section: SettingsSection;
  group: SettingsGroup;
  byPath: Map<string, EditorSetting>;
  fields: {
    scope: SettingsScope;
    specialists: SpecialistOption[];
    projects: readonly RepositoryView[];
    runtime: string;
    draft: Draft;
  };
}) {
  const { t } = useTranslation();
  const fields = section.paths.flatMap((path) => byPath.get(path) ?? []);
  if (fields.length === 0) return null;
  const switchPath = `runtimes.${section.key}.enabled`;
  const switchDraft = shared.draft.drafts[switchPath];
  const off =
    group === 'runtimes' && byPath.has(switchPath)
      ? !(typeof switchDraft === 'boolean' ? switchDraft : byPath.get(switchPath)?.value)
      : false;
  const storage =
    shared.draft.drafts['attachments.storage'] ?? byPath.get('attachments.storage')?.value;
  return (
    <SectionCard
      id={`section-${group}-${section.key}`}
      title={t(`settingsPage.section.${group}_${section.key}` as never)}
      mark={off ? t('settingsPage.runtimeOff') : undefined}
    >
      {group === 'system' && section.key === 'stats' ? <StatsNote /> : null}
      <SectionFields
        fields={fields}
        {...shared}
        s3Disabled={group === 'system' && section.key === 'attachments' && storage !== 's3'}
      />
    </SectionCard>
  );
}

/** The fields of one card. */
function SectionFields({
  fields,
  scope,
  specialists,
  projects,
  runtime,
  draft,
  s3Disabled = false,
}: {
  fields: EditorSetting[];
  scope: SettingsScope;
  specialists: SpecialistOption[];
  projects: readonly RepositoryView[];
  runtime: string;
  draft: Draft;
  s3Disabled?: boolean;
}) {
  return fields.map((field) =>
    field.kind === 'env' ? (
      <EnvEditor
        key={field.path}
        field={field}
        drafts={draft.drafts}
        error={draft.errorOf(field.path)}
        disabled={draft.busy}
        onChange={(path, value) => draft.change(path, value, undefined)}
        onClear={draft.clear}
      />
    ) : (
      <SettingField
        key={field.path}
        setting={field}
        scope={scope}
        draft={draft.drafts[field.path]}
        specialists={specialists}
        projects={projects}
        runtime={runtime}
        error={draft.errorOf(field.path)}
        disabled={draft.busy || (s3Disabled && field.path.startsWith('attachments.s3.'))}
        onChange={(value) => {
          // Clearing a field the project does not set removes nothing: it stays inherited.
          const empty =
            value === null || value === '' || (Array.isArray(value) && value.length === 0);
          if (scope === 'project' && field.written.project === undefined && empty)
            draft.clear(field.path);
          else draft.change(field.path, value, savedValue(field, scope));
        }}
        onInherit={() => draft.change(field.path, INHERIT, undefined)}
        onKeep={() => draft.clear(field.path)}
      />
    ),
  );
}

function useAttachmentStorage(
  group: SettingsGroup,
  storage: unknown,
  onAttachmentStorage?: (storage: string) => void,
) {
  useEffect(() => {
    if (group === 'system') onAttachmentStorage?.(storage === 's3' ? 's3' : 'local');
  }, [storage, group, onAttachmentStorage]);
}

function selectedRuntime(byPath: Map<string, EditorSetting>, draft: Draft, scope: SettingsScope) {
  const saved = byPath.get('naming.runtime');
  const changed = draft.drafts['naming.runtime'];
  const value =
    typeof changed === 'string' ? changed : saved ? savedValue(saved, scope) : undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * The form of one group: the sections are cards, the fields are the controls of their kind. The
 * changes are a draft; «Save» writes all of them to the file of the tab in one go.
 */
export function SettingsForm({
  api,
  config,
  scope,
  group,
  sections: shownSections,
  projects = [],
  onSaved,
  onDirty,
  onAttachmentStorage,
}: {
  api: Api;
  config: ConfigEditorResponse;
  scope: SettingsScope;
  group: SettingsGroup;
  /** The cards to show instead of those of the group (the settings of a built-in stage). */
  sections?: SettingsSection[];
  /** The projects of the registry: the choices of `stats.exclude`. */
  projects?: readonly RepositoryView[];
  /** Called after a write, and by «Reload»: the page reads the configuration again. */
  onSaved: () => Promise<void> | void;
  onDirty: (dirty: boolean) => void;
  onAttachmentStorage?: (storage: string) => void;
}) {
  const { t } = useTranslation();
  const sections = shownSections ?? SETTINGS_SECTIONS[group] ?? [];
  const byPath = useMemo(
    () => new Map(config.settings.map((setting) => [setting.path, setting])),
    [config.settings],
  );
  const known = useMemo(() => new Set(byPath.keys()), [byPath]);
  const specialists = useMemo(() => specialistOptions(config.specialists), [config.specialists]);
  const draft = useSettingsDraft({ api, config, scope, known, onSaved, onDirty });
  const attachmentStorage =
    draft.drafts['attachments.storage'] ?? byPath.get('attachments.storage')?.value;
  useAttachmentStorage(group, attachmentStorage, onAttachmentStorage);
  const runtime = selectedRuntime(byPath, draft, scope);
  const { dirty, busy } = draft;
  const reload = () => {
    draft.discard();
    void onSaved();
  };

  return (
    <ModelCatalogProvider api={api}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !busy) void draft.save();
        }}
      >
        <div className="@container">
          <div className="grid gap-3 @3xl:grid-cols-2" data-testid="settings-sections">
            {sections.map((section) => (
              <SectionCards
                key={section.key}
                section={section}
                group={group}
                byPath={byPath}
                fields={{ scope, specialists, projects, runtime, draft }}
              />
            ))}
          </div>
        </div>
        <FormAlerts draft={draft} onReload={reload} />
        <div className="flex gap-2">
          <Button type="submit" disabled={!dirty || busy} loading={busy}>
            {t('settingsPage.save')}
          </Button>
          <Button type="button" variant="outline" disabled={!dirty || busy} onClick={draft.discard}>
            {t('settingsPage.discard')}
          </Button>
        </div>
      </form>
    </ModelCatalogProvider>
  );
}
