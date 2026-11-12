import { useTranslation } from 'react-i18next';

import type { ConfigCatalogResponse, EditorChain, FieldError } from '../../../shared/api/types.ts';
import { SpecialistFields, type Draft } from '../../specialists/index.ts';
import { SPECIALIST_PREFIX, type Form } from './form.ts';

/** The specialist of the observer: the fields of a specialist file it can have. */
export function SpecialistTab({
  form,
  setForm,
  busy,
  errors,
  defaults,
  catalog,
  catalogError,
  chains,
}: {
  form: Form;
  setForm: (change: (current: Form | null) => Form | null) => void;
  busy: boolean;
  errors: FieldError[];
  defaults: Record<string, unknown>;
  catalog: ConfigCatalogResponse | null;
  catalogError: string | null;
  chains: EditorChain[];
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="text-sm text-muted-foreground">{t('observers.specialist.hint')}</p>
      <SpecialistFields
        draft={form.specialist}
        onDraft={(change) =>
          setForm((current) => current && { ...current, specialist: change(current.specialist) })
        }
        disabled={busy}
        errors={errors}
        prefix={SPECIALIST_PREFIX}
        defaults={defaults}
        catalog={catalog}
        catalogError={catalogError}
        chains={chains}
        omit={['max', 'tags']}
      />
    </>
  );
}
