import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api, QueueSettingsPatch } from '../../api.ts';
import { notifySuccess } from '../../notify.ts';
import { formatRoute } from '../../route.ts';
import type { ConfigEditorResponse, QueueView } from '../../types.ts';

import { Button } from '../../ui/button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.tsx';
import { Textarea } from '../../ui/textarea.tsx';

import { DeliveryFields, Toggle } from './DeliveryFields.tsx';

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
  const [pending, setPending] = useState<
    Partial<Record<'autopilot' | 'autoAnswer' | 'skipFailed', boolean>>
  >({});
  const [answer, setAnswer] = useState<string | null>(null);
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [pendingLimit, setPendingLimit] = useState<'wait' | 'stop' | null>(null);

  const changeLimit = async (value: 'wait' | 'stop') => {
    if (value === queue.onLimit) return;
    setPendingLimit(value);
    try {
      onQueue(await api.queueSettings({ onLimit: value }));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPendingLimit(null);
    }
  };

  const toggle = async (key: 'autopilot' | 'autoAnswer' | 'skipFailed', value: boolean) => {
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

  const shownAnswer = answer ?? queue.autopilotAnswer ?? queue.autopilotAnswerDefault;
  const saveAnswer = async (value: string | null) => {
    setSavingAnswer(true);
    try {
      onQueue(await api.queueSettings({ autopilotAnswer: value }));
      setAnswer(null);
      notifySuccess(t('queue.settings.autopilotAnswerSaved'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setSavingAnswer(false);
    }
  };

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
      <div className={`flex flex-col gap-1 ${queue.autoAnswer ? '' : 'opacity-60'}`}>
        <label htmlFor="queue-autopilot-answer" className="text-sm font-medium">
          {t('queue.settings.autopilotAnswer')}
        </label>
        <Textarea
          id="queue-autopilot-answer"
          value={shownAnswer}
          maxLength={2000}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <p id="queue-autopilot-answer-hint" className="text-xs text-muted-foreground">
          {t('queue.settings.autopilotAnswerHint')}
        </p>
        {queue.autoAnswer ? null : (
          <p id="queue-autopilot-answer-inactive" className="text-xs font-medium">
            {t('queue.settings.autopilotAnswerInactive')}
          </p>
        )}
        <span className="flex gap-2">
          <Button
            size="sm"
            disabled={
              savingAnswer ||
              answer === null ||
              answer.trim() === '' ||
              answer.trim() === (queue.autopilotAnswer ?? queue.autopilotAnswerDefault)
            }
            onClick={() => void saveAnswer(answer === null ? null : answer.trim())}
          >
            {t('queue.settings.autopilotAnswerSave')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={savingAnswer || (answer === null && queue.autopilotAnswer === null)}
            onClick={() => void saveAnswer(null)}
          >
            {t('queue.settings.autopilotAnswerDefault')}
          </Button>
        </span>
      </div>
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
      <div className="flex flex-col gap-0.5">
        <label htmlFor="queue-on-limit" className="text-sm font-medium">
          {t('queue.settings.onLimit')}
        </label>
        <Select
          value={pendingLimit ?? queue.onLimit}
          disabled={pendingLimit !== null}
          onValueChange={(value) => void changeLimit(value === 'stop' ? 'stop' : 'wait')}
        >
          <SelectTrigger id="queue-on-limit" aria-describedby="queue-on-limit-hint">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="wait">{t('queue.settings.onLimitWait')}</SelectItem>
            <SelectItem value="stop">{t('queue.settings.onLimitStop')}</SelectItem>
          </SelectContent>
        </Select>
        <p id="queue-on-limit-hint" className="text-xs text-muted-foreground">
          {t('queue.settings.onLimitHint')}
        </p>
      </div>
    </section>
  );
}
