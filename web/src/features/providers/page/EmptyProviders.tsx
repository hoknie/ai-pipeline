import { Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import { buttonVariants } from '../../../shared/ui/forms/button.tsx';
import { PRESET_IDS, PRESET_NAMES } from '../form/presets.ts';

const defaultHref = (preset: string | null) =>
  preset === null ? '#providers/new' : `#providers/new?preset=${preset}`;

/** No providers yet: what a provider is, and the ways to create the first one. */
export function EmptyProviders({
  onCreate,
  hrefOfNew = defaultHref,
}: {
  onCreate: (preset: string | null) => void;
  /** The address of the form of a new provider, for opening in a new tab; the top bar's by default. */
  hrefOfNew?: (preset: string | null) => string;
}) {
  const { t } = useTranslation();
  return (
    <Empty
      icon={<Server />}
      title={t('providers.empty.title')}
      className="rounded-lg border"
      data-testid="providers-empty"
    >
      <p className="max-w-xl">{t('providers.empty.description')}</p>
      <a
        href={hrefOfNew(null)}
        className={buttonVariants({ variant: 'default' })}
        onClick={(event) => {
          event.preventDefault();
          onCreate(null);
        }}
      >
        {t('providers.empty.create')}
      </a>
      <div
        className="flex flex-wrap justify-center gap-2"
        aria-label={t('providers.empty.presets')}
      >
        {PRESET_IDS.map((id) => (
          <a
            key={id}
            href={hrefOfNew(id)}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            onClick={(event) => {
              event.preventDefault();
              onCreate(id);
            }}
          >
            {id === 'custom' ? t('providers.form.presets.custom') : PRESET_NAMES[id]}
          </a>
        ))}
      </div>
    </Empty>
  );
}
