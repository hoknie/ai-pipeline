import { ChevronRight, MessageSquare, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { clockSeconds, cost, dateTime, duration, tokens } from '../../../shared/lib/format.ts';
import type { AttemptView, TranscriptEntry } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { authorOf } from '../../../shared/api/observerTypes.ts';
import { Markdown } from '../../../shared/ui/layout/Markdown.tsx';
import { StatusBadge } from '../../../shared/ui/feedback/StatusBadge.tsx';
import { EntryTime, Transcript } from '../transcript/Transcript.tsx';

/** The marks and buttons next to the line of an attempt. */
export function AttemptActions(props: {
  attempt: AttemptView;
  onMessage?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {props.attempt.interrupting ? (
        <span className="text-xs text-status-warn">{t('runs.attempt.interrupting')}</span>
      ) : null}
      {props.onMessage ? (
        <Button variant="outline" size="sm" onClick={props.onMessage}>
          <MessageSquare />
          {t('runs.message.button')}
        </Button>
      ) : null}
      {props.onRetry ? (
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          <RotateCcw />
          {t('runs.attempt.retryStep')}
        </Button>
      ) : null}
    </>
  );
}

/** The line of an attempt: its number, model, verdict, duration, tokens and warnings. */
export function AttemptHeading({ attempt, verdict }: { attempt: AttemptView; verdict: string }) {
  const { t } = useTranslation();
  // A daemon older than the panel sends no denials.
  const denials = attempt.denials ?? [];
  const outside = attempt.outsideChanges ?? [];
  return (
    <>
      <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
      <span className="font-medium">
        #{attempt.seq} {attempt.stepName ?? attempt.stepId}
        {attempt.round > 1 ? ` · ${t('runs.attempt.round', { round: attempt.round })}` : ''}
      </span>
      <span
        className="truncate text-muted-foreground"
        title={`${attempt.specialist} · ${attempt.runtime} ${attempt.model ?? ''}`.trim()}
      >
        {attempt.model ?? attempt.runtime}
      </span>
      <StatusBadge status={verdict} />
      <span className="text-xs text-muted-foreground tabular-nums">
        {duration(attempt.durationMs)} · {tokens(attempt.usage?.inputTokens)}/
        {tokens(attempt.usage?.outputTokens)} · {cost(attempt.usage) || '—'}
      </span>
      {denials.length > 0 ? (
        <span className="text-xs text-status-warn" title={t('runs.attempt.denialsTitle')}>
          {t('runs.attempt.denials', { n: denials.length })}
        </span>
      ) : null}
      {outside.length > 0 ? (
        <span className="text-xs text-status-warn" title={t('runs.attempt.outsideTitle')}>
          {t('runs.attempt.outside', { n: outside.length })}
        </span>
      ) : null}
    </>
  );
}

type Denial = NonNullable<AttemptView['denials']>[number];

function Denials({ denials }: { denials: Denial[] }) {
  const { t } = useTranslation();
  if (denials.length === 0) return null;
  return (
    <section aria-label={t('runs.attempt.denialsLabel')}>
      <Alert variant="warn">
        <div className="mb-1 text-xs font-medium uppercase">{t('runs.attempt.denialsHeading')}</div>
        <ul className="flex flex-col gap-1">
          {denials.map((denial, index) => (
            <li key={index}>
              <code className="font-mono text-xs">
                {denial.command === null ? denial.tool : `${denial.tool} ${denial.command}`}
              </code>
              {denial.suggestions.map((suggestion, part) => (
                <div key={part} className="text-xs">
                  {suggestion.pattern === null ? (
                    <span>{t('runs.attempt.noPattern')}</span>
                  ) : (
                    <>
                      {t('runs.attempt.pattern')} <code>{suggestion.pattern}</code>
                    </>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </Alert>
    </section>
  );
}

/** What an open attempt shows: the reason, the denials, the log, the summary and the feedback. */
export function AttemptBody({
  attempt,
  rawLog,
  transcript,
  onlyReplies,
  showJson,
  raw,
  onRaw,
}: {
  attempt: AttemptView;
  rawLog: string[] | null;
  transcript: { entries: TranscriptEntry[] } | null;
  onlyReplies: boolean;
  showJson: boolean;
  raw: boolean;
  onRaw: (raw: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const denials = attempt.denials ?? [];
  return (
    <div className="flex flex-col gap-3 border-t p-3">
      {attempt.reason ? <Alert variant="destructive">{attempt.reason}</Alert> : null}
      <Denials denials={denials} />
      <p className="text-xs text-muted-foreground">
        <time
          dateTime={new Date(attempt.startedAt).toISOString()}
          title={dateTime(attempt.startedAt, i18n.language)}
          className="tabular-nums"
        >
          {t('runs.attempt.started', { time: clockSeconds(attempt.startedAt) })}
        </time>
      </p>
      <HumanMessage attempt={attempt} />
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{t('runs.attempt.log')}</h4>
        {rawLog ? (
          <div className="flex items-center gap-2">
            <Switch id={`raw-${attempt.seq}`} checked={raw} onCheckedChange={onRaw} />
            <Label htmlFor={`raw-${attempt.seq}`} className="text-xs">
              {t('runs.attempt.raw')}
            </Label>
          </div>
        ) : null}
      </div>
      {raw && rawLog ? (
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
          {rawLog.join('\n')}
        </pre>
      ) : transcript ? (
        <Transcript entries={transcript.entries} onlyText={onlyReplies} showJson={showJson} />
      ) : (
        <Skeleton role="status" aria-label={t('runs.attempt.loadingLog')} className="h-16" />
      )}
      <SummaryAndFeedback attempt={attempt} />
    </div>
  );
}

function HumanMessage({ attempt }: { attempt: AttemptView }) {
  const { t } = useTranslation();
  return (
    <>
      {attempt.message ? (
        <section
          aria-label={t('runs.attempt.humanMessage')}
          className="rounded-lg border border-status-warn/30 bg-status-warn-bg p-3"
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-status-warn uppercase">
            <span>{t('runs.attempt.humanMessage')}</span>
            <EntryTime at={attempt.message.at} />
          </div>
          <Markdown text={attempt.message.text} />
        </section>
      ) : null}
    </>
  );
}

function SummaryAndFeedback({ attempt }: { attempt: AttemptView }) {
  const { t } = useTranslation();
  return (
    <>
      {attempt.summary ? (
        <section aria-label={t('runs.attempt.summaryLabel')} className="rounded-lg border p-3">
          <div className="mb-1 text-xs font-medium text-muted-foreground uppercase">
            {t('runs.attempt.summary')}
          </div>
          <Markdown text={attempt.summary} />
        </section>
      ) : null}
      {attempt.feedback || attempt.decision ? (
        <section
          aria-label={t('runs.attempt.feedbackLabel')}
          className="rounded-lg border border-status-warn/30 bg-status-warn-bg p-3"
        >
          <div className="mb-1 text-xs font-medium text-status-warn uppercase">
            {t('runs.attempt.feedback')}
          </div>
          {attempt.feedback ? <Markdown text={attempt.feedback} /> : null}
          {attempt.decision ? (
            <p className="mt-2 text-sm">
              <span className="font-medium">
                {t('runs.attempt.answer', {
                  by: t(`runs.decisions.${authorOf(attempt.decision.by)}`),
                })}
              </span>{' '}
              {attempt.decision.answer}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
