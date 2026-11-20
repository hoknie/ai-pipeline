import { useTranslation } from 'react-i18next';

import { Checkbox } from '../../shared/ui/forms/checkbox.tsx';

import { EVENT_KINDS } from './events.ts';

/** The kinds of events as checkboxes; `value` is the chosen kinds. */
export function EventChecks({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: readonly string[];
  onChange: (value: string[]) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-3" role="group" aria-label={t('integrations.events.title')}>
      {EVENT_KINDS.map((kind) => {
        const id = `${idPrefix}-${kind}`;
        const checked = value.includes(kind);
        return (
          <label key={kind} htmlFor={id} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              id={id}
              checked={checked}
              {...(disabled === undefined ? {} : { disabled })}
              onCheckedChange={(next) =>
                onChange(next === true ? [...value, kind] : value.filter((one) => one !== kind))
              }
            />
            {t(`integrations.events.${kind}`)}
          </label>
        );
      })}
    </div>
  );
}
