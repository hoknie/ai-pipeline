import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { AccessItem } from './AccessItem.tsx';
import { emptyAccess, type AccessDraft, type ProviderDraft } from './draft.ts';

/** The step «Access»: the ordered ways to reach the provider; the first available one is used. */
export function AccessStep({
  draft,
  errorOf,
  onChange,
}: {
  draft: ProviderDraft;
  errorOf: (field: string) => string | undefined;
  onChange: (patch: Partial<ProviderDraft>) => void;
}) {
  const { t } = useTranslation();
  const set = (index: number, patch: Partial<AccessDraft>) =>
    onChange({
      access: draft.access.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    });
  const move = (index: number, step: -1 | 1) => {
    const next = [...draft.access];
    [next[index], next[index + step]] = [next[index + step]!, next[index]!];
    onChange({ access: next });
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('providers.form.accessHint')}</p>
      {errorOf('access') ? (
        <p role="alert" className="text-xs text-destructive">
          {errorOf('access')}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {draft.access.map((access, index) => (
          <AccessItem
            key={index}
            index={index}
            count={draft.access.length}
            access={access}
            level={draft.level}
            errorOf={errorOf}
            onChange={(patch) => set(index, patch)}
            onMove={(step) => move(index, step)}
            onRemove={() => onChange({ access: draft.access.filter((_, at) => at !== index) })}
          />
        ))}
      </ul>
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => onChange({ access: [...draft.access, emptyAccess()] })}
      >
        <Plus /> {t('providers.form.addAccess')}
      </Button>
    </div>
  );
}
