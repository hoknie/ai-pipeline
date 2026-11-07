import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import {
  BETA_SETTINGS_GROUPS,
  type SettingsGroup,
  type SettingsScope,
} from '../../../shared/lib/nav/settingsGroups.ts';
import { BetaBadge } from './BetaBadge.tsx';
import { hrefOf } from './hrefOf.ts';

/** The groups of the open tab; a group with errors is marked. */
export function GroupNav({
  groups,
  scope,
  group,
  errors,
  leave,
}: {
  groups: readonly SettingsGroup[];
  scope: SettingsScope;
  group: SettingsGroup;
  errors: ReadonlyMap<string, unknown>;
  leave: (href: string) => (event: React.MouseEvent) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('settingsPage.groups')}>
      <ul className="flex flex-wrap gap-1 lg:flex-col">
        {groups.map((key) => (
          <li key={key}>
            <a
              href={hrefOf(scope, key)}
              onClick={leave(hrefOf(scope, key))}
              aria-current={key === group ? 'page' : undefined}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-sm font-medium hover:bg-accent',
                key === group && 'border-border bg-accent',
              )}
            >
              <span className="flex items-center gap-2">
                {t(`settingsPage.group.${key}`)}
                {BETA_SETTINGS_GROUPS.has(key) ? <BetaBadge /> : null}
              </span>
              {errors.has(key) ? (
                <span
                  className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground"
                  title={t('settingsPage.hasErrors')}
                >
                  !<span className="sr-only">{t('settingsPage.hasErrors')}</span>
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
