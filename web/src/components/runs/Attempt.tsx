import { ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { cost, duration, tokens } from '../../format.ts';
import { cn } from '../../lib/cn.ts';
import { statusTone, type Tone } from '../../status.ts';
import type { AttemptView, TranscriptEntry } from '../../types.ts';
import { Alert } from '../../ui/alert.tsx';
import { Button } from '../../ui/button.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.tsx';
import { Label } from '../../ui/label.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';
import { Switch } from '../../ui/switch.tsx';
import { Markdown } from '../Markdown.tsx';
import { StatusBadge } from '../StatusBadge.tsx';
import { Transcript } from '../Transcript.tsx';

const TRANSCRIPT_POLL_MS = 1500;

interface Loaded {
  cursor: number;
  running: boolean;
  entries: TranscriptEntry[];
}

/** Transcript of one attempt, read while `active`; a running attempt is read further on a timer. */
function useTranscript(
  api: Api,
  runId: string,
  group: string,
  seq: number,
  active: boolean,
): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = useRef<Loaded | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      const previous = current.current;
      try {
        const next = await api.transcript(runId, group, seq, previous?.cursor ?? 0);
        if (stopped) return;
        const merged: Loaded = {
          cursor: next.cursor,
          running: next.running,
          entries: [...(previous?.entries ?? []), ...next.entries],
        };
        current.current = merged;
        setLoaded(merged);
        if (next.running) timer = setTimeout(() => void read(), TRANSCRIPT_POLL_MS);
      } catch {
        if (!stopped) timer = setTimeout(() => void read(), TRANSCRIPT_POLL_MS * 2);
      }
    };
    if (!current.current || current.current.running) void read();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, runId, group, seq, active]);
  return loaded;
}

const DOT: Record<Tone, string> = {
  run: 'bg-status-run',
  warn: 'bg-status-warn',
  err: 'bg-status-err',
  ok: 'bg-status-ok',
  mute: 'bg-status-mute',
};

export function Attempt({
  api,
  runId,
  group,
  attempt,
  initiallyOpen,
  rawLog,
  onlyReplies = false,
  showJson = true,
  onRetry,
}: {
  api: Api;
  runId: string;
  group: string;
  attempt: AttemptView;
  initiallyOpen: boolean;
  /** Raw lines of the log, known for the last attempt only. */
  rawLog: string[] | null;
  /** Show only the texts of the specialist in the transcript; one switch for the whole run. */
  onlyReplies?: boolean;
  /** Show JSON in the transcript as it is; one switch for the whole run. */
  showJson?: boolean;
  /** Retries the step; given for the last attempt of a failed group only. */
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const [raw, setRaw] = useState(false);
  const transcript = useTranscript(api, runId, group, attempt.seq, open);
  const verdict = attempt.verdict ?? attempt.status;
  // A daemon older than the panel sends no denials.
  const denials = attempt.denials ?? [];
  const outside = attempt.outsideChanges ?? [];
  return (
    <li className="relative pl-6">
      <span
        aria-hidden
        className={cn(
          'absolute top-3.5 left-0 size-3 -translate-x-1/2 rounded-full ring-4 ring-background',
          DOT[statusTone(verdict)],
        )}
      />
      <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 pr-2">
          <CollapsibleTrigger
            aria-label={t('runs.attempt.label', { seq: attempt.seq, step: attempt.stepId })}
            className="group flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm"
          >
            <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
            <span className="font-medium">
              #{attempt.seq} {attempt.stepId}
              {attempt.round > 1 ? ` · ${t('runs.attempt.round', { round: attempt.round })}` : ''}
            </span>
            <span
              className="truncate text-muted-foreground"
              title={`${attempt.runtime} ${attempt.model ?? ''}`}
            >
              {attempt.specialist}
              {attempt.model ? ` · ${attempt.model}` : ''}
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
          </CollapsibleTrigger>
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw />
              {t('runs.attempt.retryStep')}
            </Button>
          ) : null}
        </div>
        <CollapsibleContent>
          {open ? (
            <div className="flex flex-col gap-3 border-t p-3">
              {attempt.reason || onRetry ? (
                <Alert variant="destructive" className="flex items-center justify-between gap-3">
                  <span>{attempt.reason}</span>
                  {onRetry ? (
                    <Button variant="outline" size="sm" onClick={onRetry}>
                      {t('runs.attempt.retryStep')}
                    </Button>
                  ) : null}
                </Alert>
              ) : null}
              {denials.length > 0 ? (
                <section aria-label={t('runs.attempt.denialsLabel')}>
                  <Alert variant="warn">
                    <div className="mb-1 text-xs font-medium uppercase">
                      {t('runs.attempt.denialsHeading')}
                    </div>
                    <ul className="flex flex-col gap-1">
                      {denials.map((denial, index) => (
                        <li key={index}>
                          <code className="font-mono text-xs">
                            {denial.command === null
                              ? denial.tool
                              : `${denial.tool} ${denial.command}`}
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
              ) : null}
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">{t('runs.attempt.log')}</h4>
                {rawLog ? (
                  <div className="flex items-center gap-2">
                    <Switch id={`raw-${attempt.seq}`} checked={raw} onCheckedChange={setRaw} />
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
                <Transcript
                  entries={transcript.entries}
                  onlyText={onlyReplies}
                  showJson={showJson}
                />
              ) : (
                <Skeleton
                  role="status"
                  aria-label={t('runs.attempt.loadingLog')}
                  className="h-16"
                />
              )}
              {attempt.summary ? (
                <section
                  aria-label={t('runs.attempt.summaryLabel')}
                  className="rounded-lg border p-3"
                >
                  <div className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                    {t('runs.attempt.summary')}
                  </div>
                  <Markdown text={attempt.summary} />
                </section>
              ) : null}
              {attempt.feedback ? (
                <section
                  aria-label={t('runs.attempt.feedbackLabel')}
                  className="rounded-lg border border-status-warn/30 bg-status-warn-bg p-3"
                >
                  <div className="mb-1 text-xs font-medium text-status-warn uppercase">
                    {t('runs.attempt.feedback')}
                  </div>
                  <Markdown text={attempt.feedback} />
                </section>
              ) : null}
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
