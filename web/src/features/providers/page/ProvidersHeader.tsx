import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { buttonVariants } from '../../../shared/ui/forms/button.tsx';
import { LinkTabs } from '../../../shared/ui/layout/LinkTabs.tsx';

/** The title with «Create provider» and the tabs «Providers» and «Roles». */
export function ProvidersHeader({
  onRoles,
  onSelect,
}: {
  onRoles: boolean;
  onSelect: (run: string | null, section?: string | null) => void;
}) {
  const { t } = useTranslation();
  const open =
    (run: string | null, section: string | null) => (event: { preventDefault(): void }) => {
      event.preventDefault();
      onSelect(run, section);
    };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h2 className="text-lg font-semibold">{t('providers.title')}</h2>
        <a
          href="#providers/new"
          className={buttonVariants({ size: 'sm' })}
          onClick={open('new', null)}
        >
          <Plus /> {t('providers.createButton')}
        </a>
      </div>
      <div className="px-4">
        <LinkTabs
          label={t('providers.tabs.label')}
          tabs={[
            {
              key: 'providers',
              label: t('providers.tabs.providers'),
              href: '#providers',
              selected: !onRoles,
              onClick: open(null, null),
            },
            {
              key: 'roles',
              label: t('providers.tabs.roles'),
              href: '#providers/roles',
              selected: onRoles,
              onClick: open(null, 'roles'),
            },
          ]}
        />
      </div>
    </>
  );
}
