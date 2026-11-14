import { useTranslation } from 'react-i18next';

import type { EditorSetting } from '../../../api/types.ts';
import { EnvField } from './EnvField.tsx';
import { INHERIT, type DraftValue } from './SettingField.tsx';
import { envPath } from './settingFields.ts';
import type { Drafts } from './useSettingsDraft.ts';

/** The variables of one runtime: the draft keeps one entry per variable. */
export function EnvEditor({
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
