import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../shared/ui/forms/button.tsx';
import { Input } from '../../shared/ui/forms/input.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../shared/ui/overlays/dialog.tsx';

import { createToken, listTokens, revokeToken, type TokenRow } from './accountApi.ts';

const day = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** «Access tokens»: the personal tokens of the signed in user; a new value is shown once. */
export function TokensDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState('');
  const [days, setDays] = useState('30');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    listTokens().then(setTokens, (reason: Error) => setError(reason.message));
  }, []);
  useEffect(() => {
    if (open) reload();
  }, [open, reload]);
  const issue = async () => {
    setError(null);
    try {
      const made = await createToken(name.trim(), `${days}d`);
      setCreated(made.value);
      setName('');
      reload();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const revoke = async (token: TokenRow) => {
    await revokeToken(token.id);
    reload();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('account.tokens.title')}</DialogTitle>
          <DialogDescription>{t('account.tokens.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('account.tokens.name')}
            aria-label={t('account.tokens.name')}
          />
          <Input
            className="w-20"
            value={days}
            onChange={(event) => setDays(event.target.value)}
            aria-label={t('account.tokens.days')}
          />
          <Button onClick={() => void issue()} disabled={name.trim() === ''}>
            {t('account.tokens.create')}
          </Button>
        </div>
        {created === null ? null : (
          <p role="status" className="rounded border p-2 text-sm">
            {t('account.tokens.once')} <code className="break-all">{created}</code>
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <ul className="space-y-1 text-sm">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-2">
              <span>
                <b>{token.name}</b> <code>{token.start}…</code>{' '}
                {t('account.tokens.expires', { date: day(token.expiresAt) })}
              </span>
              <Button variant="outline" size="sm" onClick={() => void revoke(token)}>
                {t('account.tokens.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
