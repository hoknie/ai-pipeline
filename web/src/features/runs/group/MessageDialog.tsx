import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../shared/ui/overlays/dialog.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Textarea } from '../../../shared/ui/forms/textarea.tsx';

/** Asks for a message to a running specialist; stays open with the text when sending fails. */
export function MessageDialog({
  onSend,
  onClose,
}: {
  /** Sends the text; rejects when the daemon refuses. */
  onSend: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const empty = text.trim() === '';
  const send = async () => {
    if (empty || busy) return;
    setBusy(true);
    try {
      await onSend(text);
      onClose();
    } catch {
      // the caller shows the error; the text stays for another try
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('runs.message.title')}</DialogTitle>
          <DialogDescription>{t('runs.message.desc')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-status-warn">{t('runs.message.warn')}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-message">{t('runs.message.label')}</Label>
          <Textarea
            id="agent-message"
            autoFocus
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <span className="text-xs text-muted-foreground">{t('runs.message.hint')}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={empty} onClick={() => void send()}>
            {t('runs.message.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
