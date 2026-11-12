import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { modelsOf, useModelCatalog } from '../../../shared/lib/catalog/models.tsx';
import { ModelPicker } from '../../../shared/ui/forms/ModelPicker.tsx';

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
      models={entry?.models ?? []}
      error={entry?.error ?? error}
      loading={loading}
      onRefresh={refresh}
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
    />
  );
}
