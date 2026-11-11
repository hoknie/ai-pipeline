import { useTranslation } from 'react-i18next';

import type { NetworkStatus } from '../../../shared/api/types.ts';
import { clock } from '../../../shared/lib/format.ts';
import { Row } from './Row.tsx';

/** The card of the network: the state the daemon holds, why it is down and since when. */
export function NetworkCard({ network }: { network: NetworkStatus | null }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('system.network.label')}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
    >
      <h3 className="font-semibold">{t('system.network.title')}</h3>
      {network === null ? (
        <p className="text-sm text-muted-foreground">{t('system.unknown')}</p>
      ) : (
        <dl className="flex flex-col gap-1 text-sm">
          <Row label={t('system.state')}>{t(`system.network.state.${network.state}`)}</Row>
          {network.problem ? (
            <Row label={t('system.network.problem')}>{network.problem}</Row>
          ) : null}
          {network.state !== 'off' ? (
            <Row label={t('system.network.since')}>{clock(network.since)}</Row>
          ) : null}
          {network.checkedAt !== null ? (
            <Row label={t('system.network.checked')}>{clock(network.checkedAt)}</Row>
          ) : null}
          {network.proxy ? (
            <Row label={t('system.network.proxy')}>
              <code>{network.proxy}</code>
            </Row>
          ) : null}
        </dl>
      )}
    </section>
  );
}
