import { Ban, CircleCheck, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { TaskLinkView } from '../../../shared/api/types.ts';
import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { taskNumber } from '../../../shared/lib/format.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import { Badge, badgeVariants } from '../../../shared/ui/feedback/badge.tsx';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { linkKinds, inverseLinkKinds, type LinkKind } from './linkKinds.ts';

const icons = { done: CircleCheck, waiting: Clock, blocked: Ban } as const;
const tones = { done: 'ok', waiting: 'warn', blocked: 'err' } as const;

function Chip({
  link,
  repository,
  onProject,
  blocking,
  linkItems,
}: {
  link: TaskLinkView;
  repository: string;
  onProject?: ((path: string) => void) | undefined;
  blocking: boolean;
  linkItems?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const state = blocking ? link.state : undefined;
  const Icon = state ? icons[state] : null;
  const tone = state ? tones[state] : 'mute';
  const foreign = link.repository !== null && link.repository !== repository;
  const project = foreign && link.repository ? repositoryLabel(link.repository) : null;
  const title = `${link.number === null ? '' : `${taskNumber(link.number)} `}${link.title || link.id}`;
  const hint = [state ? t(`queue.dependency.${state}`) : null, project, title]
    .filter(Boolean)
    .join(': ');
  const body = (
    <>
      {Icon ? <Icon aria-hidden /> : null}
      {project ? (
        <span className="inline-flex shrink-0 items-center gap-1 font-semibold" data-project="">
          <ProjectDot path={link.repository!} />
          {project}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{title}</span>
      {state ? <span className="sr-only">{t(`queue.dependency.${state}`)}</span> : null}
    </>
  );
  const className = cn(badgeVariants({ variant: tone }), 'max-w-full sm:max-w-[16rem]');
  if (link.ref === 'run')
    return (
      <a
        className={cn(className, 'underline')}
        title={hint}
        data-state={state}
        href={formatRoute({ view: 'runs', run: link.id, group: null, step: null, tab: null })}
      >
        {body}
      </a>
    );
  if (foreign && link.ref === 'item' && onProject && link.repository)
    return (
      <button
        type="button"
        className={cn(className, 'underline')}
        title={t('queue.list.openProjectQueue', { project: project ?? '' })}
        data-state={state}
        onClick={() => onProject(link.repository!)}
      >
        {body}
      </button>
    );
  if (linkItems && link.ref === 'item')
    return (
      <a href="#queue" className={cn(className, 'underline')} title={hint}>
        {body}
      </a>
    );
  return (
    <Badge variant={tone} className="max-w-full sm:max-w-[16rem]" title={hint} data-state={state}>
      {body}
    </Badge>
  );
}

/** The direct and reverse link groups shared by queue rows and run headers. */
export function LinkChips({
  links,
  linkedBy,
  repository,
  onProject,
  onRemove,
  linkItems,
}: {
  links: readonly TaskLinkView[];
  linkedBy: readonly TaskLinkView[];
  repository: string;
  onProject?: ((path: string) => void) | undefined;
  onRemove?: ((link: TaskLinkView) => void) | undefined;
  linkItems?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const group = (kind: LinkKind, inverse: boolean) => {
    const values = (inverse ? linkedBy : links).filter((link) => link.kind === kind);
    if (!values.length) return null;
    const shown = inverse && kind === 'parent' ? values.slice(0, 3) : values;
    const label =
      inverse && kind !== 'related' ? t(`links.inverse.${kind}`) : t(`links.kind.${kind}`);
    return (
      <span key={`${inverse}-${kind}`} className="inline-flex min-w-0 flex-wrap items-center gap-1">
        <span className="text-muted-foreground">{label}:</span>
        {shown.map((link) => (
          <span key={link.id} className="inline-flex min-w-0 items-center gap-1">
            <Chip
              {...{ link, repository, onProject, linkItems }}
              blocking={!inverse && kind === 'blocked_by'}
            />
            {!inverse && onRemove ? (
              <button
                type="button"
                aria-label={`${t('links.remove')}: ${link.title || link.id}`}
                title={t('links.remove')}
                onClick={() => onRemove(link)}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        {shown.length < values.length ? (
          <span
            title={values
              .map(
                (link) =>
                  `${link.number === null ? '' : `${taskNumber(link.number)} `}${link.title || link.id}`,
              )
              .join('\n')}
          >
            {t('links.more', { count: values.length - shown.length })}
          </span>
        ) : null}
      </span>
    );
  };
  return (
    <>
      {linkKinds.map((kind) => group(kind, false))}
      {inverseLinkKinds.map((kind) => group(kind, true))}
    </>
  );
}
