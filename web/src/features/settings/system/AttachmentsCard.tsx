import { useTranslation } from 'react-i18next';

import { Alert } from '../../../shared/ui/feedback/alert.tsx';

/** Only the presence of credentials is exposed by the daemon, never their values. */
export function AttachmentsCard({
  s3Credentials,
  storage,
}: {
  s3Credentials: boolean;
  storage: string;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('system.attachments.status')}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
    >
      <h3 className="font-semibold">{t('system.attachments.title')}</h3>
      <p className="text-sm">
        {t('system.attachments.credentials')}:{' '}
        {t(s3Credentials ? 'system.attachments.set' : 'system.attachments.missing')}
      </p>
      <p className="text-xs text-muted-foreground">{t('system.attachments.hint')}</p>
      {storage === 's3' && !s3Credentials ? (
        <Alert variant="warn">{t('system.attachments.warning')}</Alert>
      ) : null}
    </section>
  );
}
