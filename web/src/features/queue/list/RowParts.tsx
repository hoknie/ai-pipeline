import { Ban, CircleCheck, Clock, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import { taskNumber } from '../../../shared/lib/format.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import type {
  DependencyState,
  ItemReadiness,
  PipelinesView,
  QueueItemView,
} from '../../../shared/api/types.ts';
import { Badge, badgeVariants } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/feedback/tooltip.tsx';
import { unmet } from '../queueLinks.ts';

const STATE_ICON = { done: CircleCheck, waiting: Clock, blocked: Ban } as const;
const STATE_TONE = { done: 'ok', waiting: 'warn', blocked: 'err' } as const;

/** A warning icon for a task that skips pipeline steps; the tooltip lists the skipped steps. */
export function SkippedSteps({
  item,
  pipelines,
}: {
  item: QueueItemView;
  pipelines: PipelinesView | null | undefined;
}) {
  const { t } = useTranslation();
  if (!item.skip || item.skip.length === 0) return null;
  const steps = pipelines?.pipelines.find((candidate) => candidate.id === item.pipeline)?.steps;
  const skipped = item.skip.map((id) => ({
    id,
    name: steps?.find((step) => step.id === id)?.name ?? id,
  }));
  const names = skipped.map((entry) => entry.name);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex cursor-help rounded-sm text-status-warn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          role="img"
          aria-label={t('queue.list.skips', { steps: names.join(', ') })}
        >
          <TriangleAlert className="size-4" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent className="px-3 py-2">
        <p className="font-medium">{t('queue.list.skipsTitle')}</p>
        <ul className="mt-1 list-disc pl-4">
          {skipped.map(({ id, name }) => (
            <li key={id}>{name}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** The icon and the tone of a predecessor state or a readiness; `ready` looks like `done`. */
function stateLook(state: DependencyState | ItemReadiness) {
  const key = state === 'ready' ? 'done' : state;
  return { Icon: STATE_ICON[key], tone: STATE_TONE[key] };
}

/** An icon button of a row: the label is the accessible name, the tooltip shows it with an optional hint. */
export function RowAction({
  label,
  hint,
  pressed,
  className,
  onClick,
  children,
}: {
  label: string;
  hint?: string | undefined;
  pressed?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label={label}
          aria-description={hint}
          aria-pressed={pressed}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
        {hint ? <p className="opacity-80">{hint}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function ReadinessBadge({ item }: { item: QueueItemView }) {
  const { t } = useTranslation();
  const { Icon, tone } = stateLook(item.readiness);
  const label = t(`queue.readiness.${item.readiness}`);
  const pending = unmet(item)
    .map((ref) => ref.title || ref.id)
    .join(', ');
  const title =
    pending !== ''
      ? `${label} (${item.readiness}): ${pending}`
      : item.readiness === 'ready'
        ? `${label} (${item.readiness}): ${t('queue.list.readyHint')}`
        : `${label} (${item.readiness})`;
  return (
    <Badge variant={tone} title={title} aria-label={title} data-readiness={item.readiness}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

export function DependencyChip({ dependency }: { dependency: QueueItemView['after'][number] }) {
  const { t } = useTranslation();
  const { Icon, tone } = stateLook(dependency.state);
  const name = dependency.title || dependency.id;
  const state = t(`queue.dependency.${dependency.state}`);
  const body = (
    <>
      <Icon aria-hidden />
      <span className="min-w-0 truncate">
        {dependency.number !== null ? (
          <span className="font-mono">{taskNumber(dependency.number)} </span>
        ) : null}
        {t('queue.list.after', { title: name })}
      </span>
      <span className="sr-only">{state}</span>
    </>
  );
  return dependency.kind === 'run' ? (
    <a
      className={cn(badgeVariants({ variant: tone }), 'max-w-full underline sm:max-w-[16rem]')}
      title={`${state}: ${name}`}
      data-state={dependency.state}
      href={formatRoute({ view: 'runs', run: dependency.id, group: null, step: null, tab: null })}
    >
      {body}
    </a>
  ) : (
    <Badge
      variant={tone}
      className="max-w-full sm:max-w-[16rem]"
      title={`${state}: ${name}`}
      data-state={dependency.state}
    >
      {body}
    </Badge>
  );
}
