import { useTranslation } from 'react-i18next';

import { ModelField } from '../picker/ModelField.tsx';

/** The field `naming.model`: a model of the runtime `naming.runtime` by name; an empty one is the default. */
export function ModelSettingControl({
  id,
  runtime,
  shown,
  locked,
  invalid,
  onChange,
}: {
  id: string;
  runtime: string;
  shown: unknown;
  locked: boolean;
  invalid: boolean;
  onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <ModelField
      id={id}
      runtime={runtime}
      label={t('settingsPage.field.naming_model.label')}
      value={typeof shown === 'string' ? shown : ''}
      onChange={(value) => onChange(value === '' ? null : value)}
      disabled={locked}
      invalid={invalid}
    />
  );
}
