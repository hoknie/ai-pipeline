import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../button.tsx';
import { Input } from '../input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select.tsx';
import { Textarea } from '../textarea.tsx';
import { Switch } from '../switch.tsx';
import type { EditorSetting, RepositoryView, SettingValue } from '../../../api/types.ts';
import type { SettingsScope } from '../../../lib/nav/settingsGroups.ts';
import { ValuesPicker } from '../ValuesPicker.tsx';
import { ProjectsField } from './ProjectsField.tsx';

import { MULTILINE_FIELDS, fieldKey } from './settingFields.ts';

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

interface ControlProps {
  setting: EditorSetting;
  id: string;
  label: string;
  shown: unknown;
  locked: boolean;
  invalid: boolean;
  specialists: string[];
  projects: readonly RepositoryView[];
  onChange: (value: SettingValue) => void;
}

function ChoiceControl({
  setting,
  id,
  shown,
  locked,
  invalid,
  specialists,
  onChange,
}: ControlProps) {
  const { t } = useTranslation();
  const options = setting.kind === 'choice' ? [...(setting.options ?? [])] : [NONE, ...specialists];
  const value = typeof shown === 'string' ? shown : setting.kind === 'specialist' ? NONE : '';
  return (
    <Select
      value={value}
      disabled={locked}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
    >
      <SelectTrigger id={id} aria-invalid={invalid} aria-describedby={`${id}-hint`}>
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

function TextControl({ setting, id, shown, locked, invalid, onChange }: ControlProps) {
  const { t } = useTranslation();
  const common = {
    id,
    value: typeof shown === 'string' ? shown : '',
    disabled: locked,
    'aria-invalid': invalid,
    'aria-describedby': `${id}-hint`,
  };
  if (MULTILINE_FIELDS.has(setting.path)) {
    return (
      <Textarea
        {...common}
        rows={5}
        onChange={(event) => onChange(event.target.value.trim() === '' ? null : event.target.value)}
      />
    );
  }
  return (
    <Input
      {...common}
      type="text"
      placeholder={setting.kind === 'duration' ? t('settingsPage.durationPlaceholder') : undefined}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
    />
  );
}

/** The control of a field by its kind. */
function SettingControl(props: ControlProps) {
  const { setting, id, label, shown, locked, invalid, onChange } = props;
  switch (setting.kind) {
    case 'boolean':
      return (
        <Switch
          id={id}
          checked={shown === true}
          disabled={locked}
          aria-describedby={`${id}-hint`}
          onCheckedChange={onChange}
        />
      );
    case 'choice':
    case 'specialist':
      return <ChoiceControl {...props} />;
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
          aria-describedby={`${id}-hint`}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : Number(event.target.value))
          }
        />
      );
    case 'strings':
      if (setting.path === 'stats.exclude') {
        return (
          <ProjectsField
            id={id}
            label={label}
            values={Array.isArray(shown) ? (shown as string[]) : []}
            projects={props.projects}
            onChange={(items) => onChange(items)}
            disabled={locked}
            invalid={invalid}
          />
        );
      }
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
      return <TextControl {...props} />;
  }
}

function SourceLine({
  source,
  canInherit,
  inheriting,
  onInherit,
  onKeep,
}: {
  source: 'file' | 'project' | 'inherited' | 'default';
  canInherit: boolean;
  inheriting: boolean;
  onInherit: () => void;
  onKeep: () => void;
}) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{t(`settingsPage.source.${source}`)}</span>
      {canInherit ? (
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
  );
}

/** The label and the control: a switch stands before its label, other controls below it. */
function ControlRow({
  kind,
  id,
  label,
  control,
}: {
  kind: EditorSetting['kind'];
  id: string;
  label: string;
  control: ReactNode;
}) {
  if (kind === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        {control}
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      </div>
    );
  }
  return (
    <>
      {kind === 'strings' ? null : (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      {control}
    </>
  );
}

/** One field of a form: the label, the control by its kind, the hint, the source and the error. */
export function SettingField({
  setting,
  scope,
  draft,
  specialists,
  projects,
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
  projects: readonly RepositoryView[];
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
  const locked = disabled || inheriting;
  const control = (
    <SettingControl
      setting={setting}
      id={id}
      label={label}
      shown={shown}
      locked={locked}
      invalid={error !== null}
      specialists={specialists}
      projects={projects}
      onChange={onChange}
    />
  );

  return (
    <div className="flex flex-col gap-1" data-testid={`setting-${setting.path}`}>
      <ControlRow kind={setting.kind} id={id} label={label} control={control} />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t(`settingsPage.field.${key}.hint` as never)}{' '}
        <code className="text-xs">{setting.path}</code>
      </p>
      <SourceLine
        source={source}
        canInherit={scope === 'project' && !inheriting && setting.written.project !== undefined}
        inheriting={inheriting}
        onInherit={onInherit}
        onKeep={onKeep}
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
