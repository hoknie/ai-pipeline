import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { formatRoute } from '../../shared/lib/nav/route.ts';
import type { ConfigEditorResponse, QueueView } from '../../shared/api/types.ts';
import { DeliveryFields, Toggle } from './DeliveryFields.tsx';
import { AutopilotAnswer } from './queue/AutopilotAnswer.tsx';
import { OnLimitField } from './queue/OnLimitField.tsx';
import { useQueueModes } from './queue/useQueueModes.ts';

/** The modes of the queue of a repository: autopilot, skipping, delivery and the usage limit. */
export function QueueModes({
  api,
  queue,
  repositoryName,
  config,
  onReload,
  onQueue,
  onError,
}: {
  api: Api;
  queue: QueueView;
  repositoryName: string | null;
  config: ConfigEditorResponse | null;
  onReload: () => Promise<void> | void;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const modes = useQueueModes(api, queue, onQueue, onError);
  const { pending, toggle } = modes;
  return (
    <section
      aria-label={t('queue.settings.label')}
      className="flex max-w-xl flex-col gap-3 rounded-xl border bg-card p-3"
    >
      <h3 className="font-semibold">{t('queue.settings.title')}</h3>
      <p className="text-sm text-muted-foreground">
        {repositoryName === null
          ? t('queue.settings.forNoRepository')
          : t('queue.settings.forRepository', { name: repositoryName })}{' '}
        <a
          className="underline"
          href={formatRoute({ view: 'queue', run: null, group: null, step: null, tab: null })}
        >
          {t('queue.settings.openQueue')}
        </a>
      </p>
      <Toggle
        id="queue-autopilot"
        label={t('queue.settings.autopilot')}
        hint={t('queue.settings.autopilotHint')}
        checked={pending.autopilot ?? queue.autopilot}
        disabled={pending.autopilot !== undefined}
        onChange={(value) => void toggle('autopilot', value)}
      />
      <Toggle
        id="queue-auto-answer"
        label={t('queue.settings.autoAnswer')}
        hint={t('queue.settings.autoAnswerHint')}
        checked={pending.autoAnswer ?? queue.autoAnswer}
        disabled={pending.autoAnswer !== undefined}
        onChange={(value) => void toggle('autoAnswer', value)}
      />
      <AutopilotAnswer queue={queue} modes={modes} />
      <Toggle
        id="queue-skip-failed"
        label={t('queue.settings.skipFailed')}
        hint={t('queue.settings.skipFailedHint')}
        checked={pending.skipFailed ?? queue.skipFailed}
        disabled={pending.skipFailed !== undefined}
        onChange={(value) => void toggle('skipFailed', value)}
      />
      <DeliveryFields
        api={api}
        config={config}
        onReload={onReload}
        effective={{ autoDeliver: queue.autoDeliver, deliveryMode: queue.deliveryMode }}
        idPrefix="queue"
      />
      <OnLimitField queue={queue} modes={modes} />
    </section>
  );
}
