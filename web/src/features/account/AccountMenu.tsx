import { UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { markServerMode } from '../../shared/api/http.ts';
import { Button } from '../../shared/ui/forms/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../shared/ui/overlays/dropdown-menu.tsx';

import { loadSystemMe, signOut, type Me } from './accountApi.ts';
import { TokensDialog } from './TokensDialog.tsx';
import { UsersDialog } from './UsersDialog.tsx';

/** The user menu of the server mode; the local mode shows nothing. */
export function AccountMenu({ initial }: { initial?: Me | null }) {
  const { t } = useTranslation();
  const [me, setMe] = useState<Me | null>(initial ?? null);
  const [dialog, setDialog] = useState<'tokens' | 'users' | null>(null);
  useEffect(() => {
    if (initial !== undefined) return;
    void loadSystemMe().then((system) => {
      if (system.mode === 'server') markServerMode();
      setMe(system.me);
    });
  }, [initial]);
  if (me === null) return null;
  const leave = async () => {
    await signOut().catch(() => undefined);
    window.location.assign('/auth/login');
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={t('account.menu', { name: me.name })}>
            <UserRound />
            <span className="hidden max-w-32 truncate lg:inline">{me.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{me.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog('tokens')}>
            {t('account.tokens.title')}
          </DropdownMenuItem>
          {me.admin ? (
            <DropdownMenuItem onSelect={() => setDialog('users')}>
              {t('account.users.title')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void leave()}>{t('account.logout')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TokensDialog open={dialog === 'tokens'} onClose={() => setDialog(null)} />
      <UsersDialog open={dialog === 'users'} onClose={() => setDialog(null)} />
    </>
  );
}
