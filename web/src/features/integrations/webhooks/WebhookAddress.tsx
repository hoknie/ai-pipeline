import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';

/** A new address for a webhook; the one it has is shown without its query, so it is typed whole. */
export function WebhookAddress({ onSave }: { onSave: (url: string) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input
        aria-label={t('integrations.webhooks.newUrl')}
        className="max-w-md"
        value={url}
        placeholder="https://"
        onChange={(event) => setUrl(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={url.trim() === ''}
        onClick={() => void onSave(url.trim()).then((ok) => ok && setUrl(''))}
      >
        {t('integrations.webhooks.saveUrl')}
      </Button>
    </div>
  );
}
