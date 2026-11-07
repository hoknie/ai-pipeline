import { ChevronRight, MessageSquare, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { clockSeconds, cost, dateTime, duration, tokens } from '../../../shared/lib/format.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { statusTone, type Tone } from '../../../shared/lib/status.ts';
import type { AttemptView, TranscriptEntry } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../shared/ui/layout/collapsible.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { authorOf } from '../../../shared/api/observerTypes.ts';
import { Markdown } from '../../../shared/ui/layout/Markdown.tsx';
import { StatusBadge } from '../../../shared/ui/feedback/StatusBadge.tsx';
import { AttemptActions, AttemptBody, AttemptHeading } from './AttemptParts.tsx';

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
  showJson = false,
  onRetry,
  onMessage,
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
  /** Opens the message to the specialist; given for the running last attempt only. */
  onMessage?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const [raw, setRaw] = useState(false);
  const transcript = useTranscript(api, runId, group, attempt.seq, open);
  const verdict = attempt.verdict ?? attempt.status;
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
        <div className="sticky top-[var(--group-header-height,0px)] z-[5] flex items-center gap-2 rounded-t-lg bg-card pr-2">
          <CollapsibleTrigger
            aria-label={t('runs.attempt.label', {
              seq: attempt.seq,
              step: attempt.stepName ?? attempt.stepId,
            })}
            className="group flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm"
          >
            <AttemptHeading attempt={attempt} verdict={verdict} />
          </CollapsibleTrigger>
          <AttemptActions attempt={attempt} onMessage={onMessage} onRetry={onRetry} />
        </div>
        <CollapsibleContent>
          {open ? (
            <AttemptBody
              attempt={attempt}
              rawLog={rawLog}
              transcript={transcript}
              onlyReplies={onlyReplies}
              showJson={showJson}
              raw={raw}
              onRaw={setRaw}
            />
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
