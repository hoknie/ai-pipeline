import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { notifySuccess } from '../../notify.ts';
import type { SettingsGroup, SettingsScope } from '../../settingsGroups.ts';
import type { ConfigEditorResponse, EditorSetting, SettingValue } from '../../types.ts';

import { Alert } from '../../ui/alert.tsx';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';

import { EnvField } from './EnvField.tsx';
import { INHERIT, SettingField, savedValue, type DraftValue } from './SettingField.tsx';
import { SETTINGS_SECTIONS, envPath, type SettingsSection } from './settingFields.ts';

type Drafts = Record<string, DraftValue>;

/** The path a validation error belongs to: `swarm.` and the index of a list item are dropped. */
function fieldPathOf(path: string, known: ReadonlySet<string>): string | null {
  const bare = path.replace(/^swarm\./, '').replace(/\[\d+\]$/, '');
  if (known.has(bare)) return bare;
  const env = /^(runtimes\.[a-z]+\.env)\./.exec(bare);
  return env && known.has(env[1] as string) ? (env[1] as string) : null;
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

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
  onSaved,
  onDirty,
}: {
  api: Api;
  config: ConfigEditorResponse;
  scope: SettingsScope;
  group: SettingsGroup;
  /** The cards to show instead of those of the group (the settings of a built-in stage). */
  sections?: SettingsSection[];
  /** Called after a write, and by «Reload»: the page reads the configuration again. */
  onSaved: () => Promise<void> | void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Drafts>({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());
  const [otherErrors, setOtherErrors] = useState<string[]>([]);

  const sections = shownSections ?? SETTINGS_SECTIONS[group] ?? [];
  const byPath = useMemo(
    () => new Map(config.settings.map((setting) => [setting.path, setting])),
    [config.settings],
  );
  const known = useMemo(() => new Set(byPath.keys()), [byPath]);
  const specialists = useMemo(
    () => config.specialists.map((specialist) => specialist.slug),
    [config.specialists],
  );
  const loadErrors = useMemo(() => {
    const result = new Map<string, string>();
    for (const error of config.errors) {
      const path = fieldPathOf(error.path, known);
      if (path !== null && !result.has(path)) result.set(path, error.message);
    }
    return result;
  }, [config.errors, known]);

  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const errorOf = (path: string): string | null =>
    saveErrors.get(path) ?? loadErrors.get(path) ?? null;

  /** A change that brings the field back to its saved value is no change. */
  const change = (path: string, value: DraftValue, saved: unknown) => {
    setDrafts((current) => {
      const { [path]: _old, ...rest } = current;
      return value !== INHERIT && same(value, saved) ? rest : { ...rest, [path]: value };
    });
  };

  const clear = (path: string) =>
    setDrafts((current) => {
      const { [path]: _old, ...rest } = current;
      return rest;
    });

  const setting = (path: string): EditorSetting | undefined => byPath.get(path);

  const discard = () => {
    setDrafts({});
    setSaveErrors(new Map());
    setOtherErrors([]);
    setConflict(null);
    setFailure(null);
  };

  const save = async () => {
    const values: Record<string, SettingValue> = {};
    for (const [path, draft] of Object.entries(drafts)) {
      const value = draft === INHERIT ? null : draft;
      values[path] = Array.isArray(value) && value.length === 0 ? null : value;
    }
    setBusy(true);
    setConflict(null);
    setFailure(null);
    try {
      const result = await api.writeSettings(values, config.settingsFiles[scope].revision, scope);
      if (result.ok) {
        setDrafts({});
        setSaveErrors(new Map());
        setOtherErrors([]);
        notifySuccess(t('settingsPage.saved'));
        await onSaved();
      } else if (result.reason === 'conflict') {
        setConflict(result.message);
      } else {
        const errors = new Map<string, string>();
        const others: string[] = [];
        for (const error of result.errors) {
          const path = fieldPathOf(error.path, known);
          if (path === null) others.push(`${error.path}: ${error.message}`);
          else if (!errors.has(path)) errors.set(path, error.message);
        }
        setSaveErrors(errors);
        setOtherErrors(others);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !busy) void save();
      }}
    >
      <div className="@container">
        <div className="grid gap-3 @3xl:grid-cols-2" data-testid="settings-sections">
          {sections.map((section) => {
            const fields = section.paths.flatMap((path) => setting(path) ?? []);
            if (fields.length === 0) return null;
            return (
              <Card key={section.key}>
                <section
                  aria-labelledby={`section-${group}-${section.key}`}
                  className="flex flex-col gap-3 p-4"
                >
                  <h3 id={`section-${group}-${section.key}`} className="text-sm font-semibold">
                    {t(`settingsPage.section.${group}_${section.key}` as never)}
                  </h3>
                  {fields.map((field) =>
                    field.kind === 'env' ? (
                      <EnvEditor
                        key={field.path}
                        field={field}
                        drafts={drafts}
                        error={errorOf(field.path)}
                        disabled={busy}
                        onChange={(path, value) => change(path, value, undefined)}
                        onClear={clear}
                      />
                    ) : (
                      <SettingField
                        key={field.path}
                        setting={field}
                        scope={scope}
                        draft={drafts[field.path]}
                        specialists={specialists}
                        error={errorOf(field.path)}
                        disabled={busy}
                        onChange={(value) => {
                          // Clearing a field the project does not set removes nothing: it stays inherited.
                          const empty =
                            value === null ||
                            value === '' ||
                            (Array.isArray(value) && value.length === 0);
                          if (scope === 'project' && field.written.project === undefined && empty)
                            clear(field.path);
                          else change(field.path, value, savedValue(field, scope));
                        }}
                        onInherit={() => change(field.path, INHERIT, undefined)}
                        onKeep={() => clear(field.path)}
                      />
                    ),
                  )}
                </section>
              </Card>
            );
          })}
        </div>
      </div>
      {conflict ? (
        <Alert variant="destructive" className="flex flex-wrap items-center gap-2">
          <span>{t('settingsPage.conflict', { message: conflict })}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              discard();
              void onSaved();
            }}
          >
            {t('settingsPage.reload')}
          </Button>
        </Alert>
      ) : null}
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      {otherErrors.length > 0 ? (
        <Alert variant="destructive">
          <ul>
            {otherErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!dirty || busy} loading={busy}>
          {t('settingsPage.save')}
        </Button>
        <Button type="button" variant="outline" disabled={!dirty || busy} onClick={discard}>
          {t('settingsPage.discard')}
        </Button>
      </div>
    </form>
  );
}

/** The variables of one runtime: the draft keeps one entry per variable. */
function EnvEditor({
  field,
  drafts,
  error,
  disabled,
  onChange,
  onClear,
}: {
  field: EditorSetting;
  drafts: Drafts;
  error: string | null;
  disabled: boolean;
  onChange: (path: string, value: DraftValue) => void;
  onClear: (path: string) => void;
}) {
  const { t } = useTranslation();
  const runtime = field.path.split('.')[1] ?? '';
  const prefix = `${field.path}.`;
  const mine: Record<string, string | null> = {};
  for (const [path, draft] of Object.entries(drafts)) {
    if (path.startsWith(prefix) && draft !== INHERIT) {
      mine[path.slice(prefix.length)] = draft as string | null;
    }
  }
  const names = Array.isArray(field.value) ? (field.value as string[]) : [];
  return (
    <div className="flex flex-col gap-1" data-testid={`setting-${field.path}`}>
      <span className="text-sm font-medium">{t('settingsPage.field.runtimes_env.label')}</span>
      <p className="text-xs text-muted-foreground">
        {t('settingsPage.field.runtimes_env.hint')} <code className="text-xs">{field.path}</code>
      </p>
      <EnvField
        runtime={runtime}
        names={names}
        drafts={mine}
        error={error}
        disabled={disabled}
        onSet={(name, value) => onChange(envPath(field.path, name), value)}
        onUndo={(name) => onClear(envPath(field.path, name))}
      />
    </div>
  );
}
