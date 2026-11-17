import { useTranslation } from 'react-i18next';

import { Input } from '../../../shared/ui/forms/input.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import type { ProviderDraft } from './draft.ts';
import { useProvidersScope } from '../page/scope.ts';
import { Field } from './FormParts.tsx';
import { PRESET_IDS, PRESET_NAMES, type PresetId } from './presets.ts';
import { slugOf } from './slug.ts';

const NONE = '__none';

function PresetField({ onPreset }: { onPreset: (id: PresetId) => void }) {
  const { t } = useTranslation();
  const name = (id: PresetId) =>
    id === 'custom' ? t('providers.form.presets.custom') : PRESET_NAMES[id];
  return (
    <Field
      id="provider-preset"
      label={t('providers.form.preset')}
      hint={t('providers.form.presetHint')}
    >
      <Select value={NONE} onValueChange={(id) => id !== NONE && onPreset(id as PresetId)}>
        <SelectTrigger id="provider-preset">
          <SelectValue placeholder={t('providers.form.noPreset')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('providers.form.noPreset')}</SelectItem>
          {PRESET_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              {name(id)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function LevelField({
  draft,
  isNew,
  onChange,
}: {
  draft: ProviderDraft;
  isNew: boolean;
  onChange: (patch: Partial<ProviderDraft>) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field
      id="provider-level"
      label={t('providers.form.level')}
      hint={t('providers.form.levelHint')}
    >
      <Select
        value={draft.level}
        disabled={!isNew}
        onValueChange={(level) => onChange({ level: level as 'global' | 'project' })}
      >
        <SelectTrigger id="provider-level">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="global">{t('providers.level.global')}</SelectItem>
          <SelectItem value="project">{t('providers.level.project')}</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

/** The step «Name»: a preset (new provider only), name, slug, level and the switch. */
export function NameStep({
  draft,
  isNew,
  errorOf,
  onChange,
  onPreset,
}: {
  draft: ProviderDraft;
  isNew: boolean;
  errorOf: (field: string) => string | undefined;
  onChange: (patch: Partial<ProviderDraft>) => void;
  onPreset: (id: PresetId) => void;
}) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  return (
    <div className="flex flex-col gap-4">
      {isNew ? <PresetField onPreset={onPreset} /> : null}
      <Field id="provider-name" label={t('providers.form.name')} error={errorOf('name')}>
        <Input
          id="provider-name"
          value={draft.name}
          aria-invalid={errorOf('name') ? true : undefined}
          onChange={(event) =>
            onChange({
              name: event.target.value,
              ...(isNew && !draft.slugTouched ? { slug: slugOf(event.target.value) } : {}),
            })
          }
        />
      </Field>
      <Field
        id="provider-slug"
        label={t('providers.form.slug')}
        error={errorOf('slug')}
        hint={isNew ? t('providers.form.slugHint') : undefined}
      >
        <Input
          id="provider-slug"
          value={draft.slug}
          readOnly={!isNew}
          aria-invalid={errorOf('slug') ? true : undefined}
          onChange={(event) => onChange({ slug: event.target.value, slugTouched: true })}
        />
      </Field>
      {scope === 'project' ? <LevelField draft={draft} isNew={isNew} onChange={onChange} /> : null}
      <div className="flex items-center gap-2">
        <Switch
          id="provider-enabled"
          checked={draft.enabled}
          onCheckedChange={(enabled) => onChange({ enabled })}
        />
        <label htmlFor="provider-enabled" className="cursor-pointer text-sm">
          {t('providers.form.enabled')}
        </label>
      </div>
    </div>
  );
}
