import { useTranslation } from 'react-i18next';
import type {
  HistoryResult,
  ObserverHistoryItem as Item,
} from '../../../../shared/api/observerHistoryApi.ts';
import { repositoryLabel } from '../../../../shared/lib/catalog/repositories.ts';
import { tokens, when } from '../../../../shared/lib/format.ts';
import { Badge } from '../../../../shared/ui/feedback/badge.tsx';
import { ProjectDot } from '../../../../shared/ui/feedback/ProjectDot.tsx';
import { formatDuration, formatRunHref, formatTime, formatUsd } from './format.ts';

function resultVariant(result: HistoryResult) {
  if (result === 'running') return 'run';
  if (result === 'done') return 'ok';
  if (result === 'rejected' || result === 'needs_human') return 'warn';
  if (result === 'failed') return 'err';
  if (result === 'cancelled') return 'mute';
  return 'outline';
}

/** `#296 Title`, the link to the repair of the run; the attempt below in the table. */
function RunLink({ item }: { item: Item }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 font-mono text-xs text-muted-foreground">#{item.runNumber}</span>
      <a
        className="truncate font-medium hover:underline focus-visible:outline"
        href={formatRunHref(item.runId)}
        title={item.runTitle || item.runId}
      >
        {item.runTitle || item.runId}
      </a>
    </div>
  );
}

/** The dot and the name of the project, the full path in the tooltip. */
function Project({ path }: { path: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={path}>
      <ProjectDot path={path} />
      <span className="break-all">{repositoryLabel(path)}</span>
    </span>
  );
}

function Result({ item }: { item: Item }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <Badge variant={resultVariant(item.result)}>
        {t(`observers.history.results.${item.result}` as never)}
      </Badge>
      {item.failureKind ? (
        <span className="text-xs break-all text-muted-foreground" title={item.failureKind}>
          ({item.failureKind})
        </span>
      ) : null}
    </div>
  );
}

/** Start, then the end or «—» and the duration that keeps running for a running attempt. */
function Times({ item, asOf }: { item: Item; asOf: number }) {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  return (
    <div className="flex flex-col gap-0.5">
      <time className="tabular-nums" title={formatTime(item.startedAt)}>
        {when(item.startedAt, asOf, locale)}
      </time>
      <span className="text-xs text-muted-foreground tabular-nums">
        {'→ '}
        {item.finishedAt ? (
          <time title={formatTime(item.finishedAt)}>{when(item.finishedAt, asOf, locale)}</time>
        ) : (
          <span>—</span>
        )}
        {' · '}
        {formatDuration(item.startedAt, item.finishedAt, asOf)}
      </span>
    </div>
  );
}

function Usage({ item }: { item: Item }) {
  if (!item.usage) return <span className="text-muted-foreground">—</span>;
  const exact = `${item.usage.inputTokens.toLocaleString()} / ${item.usage.outputTokens.toLocaleString()}`;
  return (
    <div className="flex flex-col items-end gap-0.5 tabular-nums">
      <span title={exact}>
        {tokens(item.usage.inputTokens)} / {tokens(item.usage.outputTokens)}
      </span>
      <span className="text-xs text-muted-foreground">{formatUsd(item.usage.costUsd)}</span>
    </div>
  );
}

export function HistoryItem({ item, asOf }: { item: Item; asOf: number }) {
  const { t } = useTranslation();
  const cell = 'px-3 py-2.5 align-top';
  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/40">
      <td className={cell}>
        <RunLink item={item} />
        <span className="text-xs text-muted-foreground">
          {t('observers.history.attempt')} #{item.attemptSeq}
        </span>
      </td>
      <td className={cell}>
        <Project path={item.repository} />
      </td>
      <td className={cell}>
        <div className="font-medium">{item.runtime}</div>
        <div className="text-xs break-all text-muted-foreground">{item.model ?? '—'}</div>
      </td>
      <td className={cell}>
        <Times item={item} asOf={asOf} />
      </td>
      <td className={cell}>
        <Result item={item} />
      </td>
      <td className={`${cell} text-right`}>
        <Usage item={item} />
      </td>
    </tr>
  );
}

export function HistoryCard({ item, asOf }: { item: Item; asOf: number }) {
  const { t } = useTranslation();
  return (
    <article className="flex min-w-0 flex-col gap-2 px-3 py-2.5 text-sm">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <RunLink item={item} />
          <span className="text-xs text-muted-foreground">
            {t('observers.history.attempt')} #{item.attemptSeq}
          </span>
        </div>
        <Result item={item} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Project path={item.repository} />
        <span className="min-w-0">
          {item.runtime} · <span className="break-all">{item.model ?? '—'}</span>
        </span>
      </div>
      <div className="flex min-w-0 items-end justify-between gap-2 text-sm">
        <Times item={item} asOf={asOf} />
        <Usage item={item} />
      </div>
    </article>
  );
}
