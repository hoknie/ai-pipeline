import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RoleView } from '../../../shared/api/types.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';

/** A role of the list: its name, slug, level, how many providers have a model of it, and the actions. */
export function RoleRow(props: {
  role: RoleView;
  count: number;
  selected: boolean;
  /** The editor view is loaded, so a write can name a revision. */
  ready: boolean;
  /** The role is in the roles of the level that is written. */
  inLevel: boolean;
  canUp: boolean;
  canDown: boolean;
  onSelect: () => void;
  onRename: () => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { role, count, selected, ready } = props;
  const { t } = useTranslation();
  const name = role.name;
  return (
    <li
      data-selected={selected ? 'true' : undefined}
      onClick={props.onSelect}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2',
        selected && 'ring-2 ring-primary',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {role.slug} · {t(`providers.level.${role.level}`)} ·{' '}
          {t('providers.roles.count', { count })}
        </span>
      </span>
      <Button
        size="icon"
        variant="ghost"
        disabled={!ready}
        aria-label={t('providers.roles.renameRole', { name })}
        onClick={props.onRename}
      >
        <Pencil />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={!ready || !props.canUp}
        aria-label={t('providers.roles.up', { name })}
        onClick={() => props.onMove(-1)}
      >
        <ArrowUp />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={!ready || !props.canDown}
        aria-label={t('providers.roles.down', { name })}
        onClick={() => props.onMove(1)}
      >
        <ArrowDown />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={!ready || !props.inLevel}
        aria-label={t('providers.roles.removeRole', { name })}
        onClick={props.onRemove}
      >
        <Trash2 />
      </Button>
    </li>
  );
}
