import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api, QueueSettingsPatch } from '../api.ts';
import { notifySuccess } from '../notify.ts';
import { queueStateLabel } from '../status.ts';
import type { QueueView } from '../types.ts';
import { useGeneralSetting } from '../useGeneralSetting.ts';

import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Switch } from '../ui/switch.tsx';

import { ParallelStepper, parseParallel } from './ParallelStepper.tsx';
import { StatusBadge } from './StatusBadge.tsx';

function Toggle({
  id,
  label,
  hint,
  note,
  checked,
  disabled,
  title,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  note?: string | null;
  checked: boolean;
  disabled: boolean;
  title?: string | undefined;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <div className="flex items-center gap-2">
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** State, start and pause, parallelism and the modes of the queue. */
export function QueueSettings({
  api,
  queue,
  onQueue,
  onError,
}: {
  api: Api;
  queue: QueueView;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [parallel, setParallel] = useState<string | null>(null);
  const [pending, setPending] = useState<Partial<Record<'autopilot' | 'skipFailed', boolean>>>({});
  const delivery = useGeneralSetting(api, 'delivery.auto');

  const parsed = parseParallel(parallel ?? String(queue.parallel));
  const busy = queue.status === 'running';
  const canStart = queue.status === 'stopped' && (queue.items.length > 0 || queue.runs.length > 0);

  const act = async (work: () => Promise<QueueView>, done: string) => {
    try {
      onQueue(await work());
      setParallel(null);
      notifySuccess(done);
    } catch (error) {
      onError((error as Error).message);
    }
  };

  const toggle = async (key: 'autopilot' | 'skipFailed', value: boolean) => {
    const patch: QueueSettingsPatch = { [key]: value };
    setPending((current) => ({ ...current, [key]: value }));
    try {
      onQueue(await api.queueSettings(patch));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPending((current) => {
        const { [key]: _gone, ...rest } = current;
        return rest;
      });
    }
  };

  const deliveryDisabled = queue.autoDeliver === null || !delivery.ready || delivery.overridden;
  const deliveryTitle =
    queue.autoDeliver === null
      ? t('queue.settings.autoDeliverInvalid')
      : delivery.overridden
        ? t('queue.settings.autoDeliverProject')
        : undefined;

  return (
    <section
      aria-label={t('queue.settings.label')}
      className="flex flex-col gap-3 rounded-xl border bg-card p-3"
    >
      <h3 className="font-semibold">{t('queue.settings.title')}</h3>
      <div>
        <StatusBadge
          status={queue.status === 'running' ? 'running' : 'stopped'}
          label={queueStateLabel(queue.status, t)}
        />
      </div>
      <span className="flex gap-2">
        <Button
          disabled={!canStart || parsed === null}
          onClick={() =>
            void act(
              () => api.queueStart(parsed !== queue.parallel ? (parsed ?? undefined) : undefined),
              t('queue.started'),
            )
          }
        >
          {t('queue.start')}
        </Button>
        <Button
          variant="outline"
          disabled={!busy}
          onClick={() => void act(() => api.queuePause(), t('queue.paused'))}
        >
          {t('queue.pause')}
        </Button>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <ParallelStepper
          api={api}
          queue={queue}
          text={parallel}
          onText={setParallel}
          onQueue={onQueue}
          onError={onError}
        />
      </div>
      <Toggle
        id="queue-autopilot"
        label={t('queue.settings.autopilot')}
        hint={t('queue.settings.autopilotHint')}
        checked={pending.autopilot ?? queue.autopilot}
        disabled={pending.autopilot !== undefined}
        onChange={(value) => void toggle('autopilot', value)}
      />
      <Toggle
        id="queue-skip-failed"
        label={t('queue.settings.skipFailed')}
        hint={t('queue.settings.skipFailedHint')}
        checked={pending.skipFailed ?? queue.skipFailed}
        disabled={pending.skipFailed !== undefined}
        onChange={(value) => void toggle('skipFailed', value)}
      />
      <Toggle
        id="queue-auto-deliver"
        label={t('queue.settings.autoDeliver')}
        hint={t('queue.settings.autoDeliverHint')}
        checked={queue.autoDeliver === true}
        disabled={deliveryDisabled || delivery.busy}
        title={deliveryTitle}
        note={deliveryTitle}
        onChange={(value) => void delivery.set(value)}
      />
      {delivery.failure ? <Alert variant="destructive">{delivery.failure}</Alert> : null}
    </section>
  );
}
