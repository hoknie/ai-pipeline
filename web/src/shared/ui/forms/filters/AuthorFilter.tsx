import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/browser/cn.ts';

import { Button } from '../button.tsx';

/** A user to choose as the author: what the directory of users gives. */
export interface AuthorOption {
  id: string;
  email: string;
  name: string;
}

/**
 * The filter «Author»: «Mine», everybody or one user. The value is `null` (everybody), `me` or a
 * user id; with `toggle` the button «Mine» sits beside the list.
 */
export function AuthorFilter({
  value,
  users,
  onChange,
  toggle = false,
  className,
}: {
  value: string | null;
  users: readonly AuthorOption[];
  onChange: (value: string | null) => void;
  toggle?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const known = value === null || value === 'me' || users.some((user) => user.id === value);
  return (
    <div
      role="group"
      aria-label={t('author.filter.label')}
      className={cn('flex items-center gap-2 text-sm', className)}
    >
      {toggle ? (
        <Button
          type="button"
          size="sm"
          variant={value === 'me' ? 'default' : 'outline'}
          aria-pressed={value === 'me'}
          onClick={() => onChange(value === 'me' ? null : 'me')}
        >
          {t('author.filter.mine')}
        </Button>
      ) : null}
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">{t('author.filter.label')}</span>
        <select
          className="h-8 max-w-56 rounded-md border border-input bg-card px-2 text-sm"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{t('author.filter.all')}</option>
          <option value="me">{t('author.filter.mine')}</option>
          {value !== null && !known ? <option value={value}>{value}</option> : null}
          {users.map((user) => (
            <option key={user.id} value={user.id} title={user.email}>
              {user.name || user.email}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
