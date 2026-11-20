import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectionView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';

/** Switch, check (when the kind has a check) and remove, the last one after a confirmation. */
export function CardActions({
  connection,
  onEnabled,
  onRemove,
  onCheck,
}: {
  connection: ConnectionView;
  onEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  onCheck?: ((id: string) => Promise<boolean>) | undefined;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [checking, setChecking] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void onEnabled(connection.id, !connection.enabled)}
      >
        {connection.enabled ? t('integrations.actions.disable') : t('integrations.actions.enable')}
      </Button>
      {onCheck === undefined ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void onCheck(connection.id).finally(() => setChecking(false));
          }}
        >
          {checking ? t('integrations.check.running') : t('integrations.check.run')}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          void confirm({
            title: t('integrations.actions.removeTitle', { name: connection.name }),
            description: t('integrations.actions.removeDescription'),
            confirmLabel: t('integrations.actions.remove'),
            cancelLabel: t('integrations.actions.cancel'),
            destructive: true,
          }).then((yes) => (yes ? onRemove(connection.id) : undefined))
        }
      >
        {t('integrations.actions.remove')}
      </Button>
    </div>
  );
}
