import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';

import { useState } from 'react';

import { Alert } from '../ui/alert.tsx';
import { Switch } from '../ui/switch.tsx';

import type { Api } from '../api.ts';
import { TagsSettings } from './TagsSettings.tsx';
import type { ConfigEditorResponse, EditorSetting } from '../types.ts';

/** Settings the panel can write; the others are shown only. */
const SWITCHES = ['delivery.auto'];

function show(value: unknown, t: TFunction): string {
  if (value === null || value === undefined) return t('settings.unset');
  if (Array.isArray(value)) return value.length === 0 ? '[]' : value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The settings of the merged configuration, each with the file it comes from. Switches write
 * the global `settings.yaml`; a value that the project file sets cannot be changed here.
 */
export function SettingsView({
  settings,
  settingsFiles,
  api,
  onChanged,
}: {
  settings: EditorSetting[];
  settingsFiles?: ConfigEditorResponse['settingsFiles'];
  api?: Api;
  /** Called after a write, to read the configuration again. */
  onChanged?: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = async (setting: EditorSetting, value: boolean) => {
    if (!api || !settingsFiles) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await api.writeSetting(
        setting.path,
        value,
        settingsFiles.global.revision,
        'global',
      );
      if (!result.ok) {
        setFailure(
          result.reason === 'conflict'
            ? t('settings.writeConflict', { message: result.message })
            : result.errors.map((error) => `${error.path}: ${error.message}`).join('; '),
        );
      }
      await onChanged?.();
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={t('settings.label')} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('settings.title')}</h2>
      <p className="text-sm text-muted-foreground">
        <Trans i18nKey="settings.readOnly" components={{ code: <code /> }} />
      </p>
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="p-2 font-medium">{t('settings.field')}</th>
            <th className="p-2 font-medium">{t('settings.value')}</th>
            <th className="p-2 font-medium">{t('settings.file')}</th>
          </tr>
        </thead>
        <tbody>
          {settings.map((setting) => (
            <tr key={setting.path} className="border-b" data-testid={`setting-${setting.path}`}>
              <td className="p-2 align-top">
                <code>{setting.path}</code>
              </td>
              <td className="p-2 align-top">
                {api && settingsFiles && SWITCHES.includes(setting.path) ? (
                  <span className="flex items-center gap-2">
                    <Switch
                      aria-label={setting.path}
                      checked={setting.value === true}
                      disabled={busy || setting.file === settingsFiles.project.file}
                      onCheckedChange={(value) => void toggle(setting, value)}
                    />
                    {setting.file === settingsFiles.project.file ? (
                      <span className="text-xs text-muted-foreground">
                        {t('settings.overriddenByProject')}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  show(setting.value, t)
                )}
              </td>
              <td className="p-2 align-top">
                {setting.file ? (
                  <code>{setting.file}</code>
                ) : (
                  <span className="text-muted-foreground">{t('settings.byDefault')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {api ? <TagsSettings api={api} /> : null}
    </section>
  );
}
