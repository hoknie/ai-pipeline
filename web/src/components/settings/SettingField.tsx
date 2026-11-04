import { useTranslation } from 'react-i18next';

import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.tsx';
import { Switch } from '../../ui/switch.tsx';
import type { EditorSetting, SettingValue } from '../../types.ts';
import type { SettingsScope } from '../../settingsGroups.ts';
import { ValuesPicker } from '../ValuesPicker.tsx';

import { fieldKey } from './settingFields.ts';

/** The draft value that returns a field of the project to the shared value (the key is removed). */
export const INHERIT = Symbol('inherit');
export type DraftValue = SettingValue | typeof INHERIT;

/** Radix `Select` has no empty value: this one stands for «not set». */
const NONE = '__none';

/** The value of the field on the tab, without the draft: the shared level or the project result. */
export function savedValue(setting: EditorSetting, scope: SettingsScope): unknown {
  return scope === 'global' && !setting.globalOnly ? setting.globalValue : setting.value;
}

/** Where the saved value of the field on the tab comes from. */
export function sourceOf(
  setting: EditorSetting,
  scope: SettingsScope,
): 'file' | 'project' | 'inherited' | 'default' {
  if (scope === 'global') return setting.written.global !== undefined ? 'file' : 'default';
  if (setting.written.project !== undefined) return 'project';
  return setting.written.global !== undefined ? 'inherited' : 'default';
}

/** One field of a form: the label, the control by its kind, the hint, the source and the error. */
export function SettingField({
  setting,
  scope,
  draft,
  specialists,
  error,
  disabled,
  onChange,
  onInherit,
  onKeep,
}: {
  setting: EditorSetting;
  scope: SettingsScope;
  draft: DraftValue | undefined;
  specialists: string[];
  error: string | null;
  disabled: boolean;
  onChange: (value: SettingValue) => void;
  onInherit: () => void;
  onKeep: () => void;
}) {
  const { t } = useTranslation();
  const key = fieldKey(setting.path);
  const id = `field-${setting.path}`;
  const inheriting = draft === INHERIT;
  const shown: unknown =
    draft === undefined ? savedValue(setting, scope) : inheriting ? setting.globalValue : draft;
  const source = inheriting ? 'inherited' : sourceOf(setting, scope);
  const label = t(`settingsPage.field.${key}.label` as never) as string;
  const hint = t(`settingsPage.field.${key}.hint` as never) as string;
  const locked = disabled || inheriting;
  const invalid = error !== null;
  const describedBy = `${id}-hint`;

  const control = (() => {
    switch (setting.kind) {
      case 'boolean':
        return (
          <Switch
            id={id}
            checked={shown === true}
            disabled={locked}
            aria-describedby={describedBy}
            onCheckedChange={onChange}
          />
        );
      case 'choice':
      case 'specialist': {
        const options =
          setting.kind === 'choice' ? [...(setting.options ?? [])] : [NONE, ...specialists];
        const value = typeof shown === 'string' ? shown : setting.kind === 'specialist' ? NONE : '';
        return (
          <Select
            value={value}
            disabled={locked}
            onValueChange={(next) => onChange(next === NONE ? null : next)}
          >
            <SelectTrigger id={id} aria-invalid={invalid} aria-describedby={describedBy}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === NONE
                    ? t('settingsPage.notSet')
                    : setting.path === 'delivery.mode'
                      ? t(`deliveryMode.${option}` as never)
                      : option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      case 'integer':
        return (
          <Input
            id={id}
            type="number"
            min={setting.range?.[0]}
            max={setting.range?.[1]}
            value={typeof shown === 'number' ? String(shown) : ''}
            disabled={locked}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) =>
              onChange(event.target.value === '' ? null : Number(event.target.value))
            }
          />
        );
      case 'strings':
        return (
          <ValuesPicker
            id={id}
            label={label}
            values={Array.isArray(shown) ? (shown as string[]) : []}
            onChange={(items) => onChange(items)}
            disabled={locked}
            invalid={invalid}
          />
        );
      default:
        return (
          <Input
            id={id}
            type="text"
            value={typeof shown === 'string' ? shown : ''}
            disabled={locked}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            placeholder={
              setting.kind === 'duration' ? t('settingsPage.durationPlaceholder') : undefined
            }
            onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
          />
        );
    }
  })();

  const sourceText =
    source === 'file'
      ? t('settingsPage.source.file')
      : source === 'project'
        ? t('settingsPage.source.project')
        : source === 'inherited'
          ? t('settingsPage.source.inherited')
          : t('settingsPage.source.default');

  return (
    <div className="flex flex-col gap-1" data-testid={`setting-${setting.path}`}>
      {setting.kind === 'boolean' ? (
        <div className="flex items-center gap-2">
          {control}
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
        </div>
      ) : (
        <>
          {setting.kind === 'strings' ? null : (
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
          )}
          {control}
        </>
      )}
      <p id={describedBy} className="text-xs text-muted-foreground">
        {hint} <code className="text-xs">{setting.path}</code>
      </p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{sourceText}</span>
        {scope === 'project' && !inheriting && setting.written.project !== undefined ? (
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onInherit}>
            {t('settingsPage.inherit')}
          </Button>
        ) : null}
        {inheriting ? (
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onKeep}>
            {t('settingsPage.keepProject')}
          </Button>
        ) : null}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
