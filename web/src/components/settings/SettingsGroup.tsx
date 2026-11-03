import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { FilePath } from '../FilePath.tsx';
import type { EditorSetting } from '../../types.ts';

export function show(value: unknown, t: TFunction): string {
  if (value === null || value === undefined) return t('settings.unset');
  if (Array.isArray(value)) return value.length === 0 ? '[]' : value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The fields of one group of `settings.yaml`, each with the file its value comes from. */
export function SettingsFields({ settings }: { settings: EditorSetting[] }) {
  const { t } = useTranslation();
  if (settings.length === 0) return null;
  return (
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
            <td className="p-2 align-top">{show(setting.value, t)}</td>
            <td className="p-2 align-top">
              {setting.file ? (
                <FilePath path={setting.file} />
              ) : (
                <span className="text-muted-foreground">{t('settings.byDefault')}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
