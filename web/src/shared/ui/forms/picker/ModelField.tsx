import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { ModelEntry } from '../../../api/types.ts';
import { modelsOf, useModelCatalog } from '../../../lib/catalog/models.tsx';
import { ModelPicker } from '../ModelPicker.tsx';

/** The field `model` of a runtime: its models come from the catalog the page provides. */
export function ModelField({
  id,
  runtime,
  label,
  value,
  onChange,
  disabled,
  invalid,
  placeholder,
  extra,
}: {
  id: string;
  runtime: string;
  /** The accessible name; default: the label of the field `model`. */
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid?: boolean;
  placeholder?: string;
  /** Models that stand before the ones of the runtime, in a group of their own. */
  extra?: ModelEntry[];
}) {
  const { t } = useTranslation();
  const { catalog, error, loading, ensure, refresh } = useModelCatalog();
  useEffect(ensure, [ensure]);
  const entry = modelsOf(catalog, runtime);
  return (
    <ModelPicker
      id={id}
      label={label ?? t('specialists.fields.model')}
      value={value}
      onChange={onChange}
      models={[...(extra ?? []), ...(entry?.models ?? [])]}
      error={entry?.error ?? error}
      loading={loading}
      onRefresh={refresh}
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
    />
  );
}
