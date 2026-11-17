import { useTranslation } from 'react-i18next';

import type { RoleView } from '../../../shared/api/types.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';

/** A role of the list on the left: its name, slug, level and how many providers have a model of it. */
export function RoleRow({
  role,
  count,
  selected,
  onSelect,
}: {
  role: RoleView;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        data-selected={selected ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'flex w-full min-w-0 flex-col rounded-lg border bg-card px-3 py-2 text-left hover:bg-accent',
          selected && 'ring-2 ring-primary',
        )}
      >
        <span className="truncate font-medium">{role.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {role.slug} · {t(`providers.level.${role.level}`)} ·{' '}
          {t('providers.roles.count', { count })}
        </span>
      </button>
    </li>
  );
}
