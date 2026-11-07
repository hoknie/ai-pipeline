import { useTranslation } from 'react-i18next';

import type { SystemView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import type { Action } from './actions.ts';
import { Row } from './Row.tsx';

/** The card of the panel: its address, version and the button that restarts it. */
export function WebCard({
  view,
  pending,
  run,
}: {
  view: SystemView;
  pending: Action | null;
  run: (action: Action) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { web } = view;
  const standalone = web.servedBy === 'standalone';
  const standby = web.servedBy === 'standby';
  return (
    <section
      aria-label={t('system.web.title')}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
    >
      <h3 className="font-semibold">{t('system.web.title')}</h3>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label={t('system.state')}>{t('system.running')}</Row>
        <Row label="pid">{web.pid}</Row>
        <Row label={t('system.address')}>
          <code>{web.url}</code>
        </Row>
        <Row label={t('system.auth')}>{web.auth}</Row>
        <Row label={t('system.version')}>{web.version}</Row>
        <Row label={t('system.build')}>
          <code>{web.build}</code>
        </Row>
      </dl>
      {standalone ? (
        <p className="text-xs text-muted-foreground">{t('system.standalone')}</p>
      ) : null}
      <div>
        <Button
          variant="outline"
          disabled={pending !== null || standalone || standby}
          onClick={() => void run('webRestart')}
        >
          {pending === 'webRestart' ? t('system.restarting') : t('system.web.restart')}
        </Button>
      </div>
    </section>
  );
}
