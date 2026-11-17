import { clockTime } from '../../feature/runs/types/index.ts';
import { limitOwner, waitNote, withTags } from './runs.ts';
import {
  type Style,
  isTerminal,
  plainStyle,
  statusBadge,
  truncateVisible,
  visibleWidth,
} from './style.ts';
import { addedAt, firstLine, pipelineLabel, runPipelineLabel, table, taskNumber } from './table.ts';
import { formatTagLabels } from './tags.ts';
import type {
  AddedToProjectView,
  GlobalQueueView,
  QueueView,
  RepositoryView,
} from '../ipc/contract/index.ts';
import { formatLinks } from './links.ts';
import { providerText } from './providers/index.ts';

export function stopReason(view: QueueView | GlobalQueueView): string | null {
  const stop = view.stop;
  if (!stop) return null;
  if (stop.kind === 'item') return `item ${stop.item}: ${stop.error}`;
  if (stop.kind === 'limit') {
    const resumes = stop.autoResume ? ', resumes automatically' : '';
    return `usage limit of ${limitOwner(stop)} in ${stop.run}, resets ${clockTime(stop.resetsAt)}${resumes}`;
  }
  const where = stop.group ? `run ${stop.run}, group ${stop.group}` : `run ${stop.run}`;
  return `${where}: ${stop.reason}`;
}

function filterLine(view: QueueView | GlobalQueueView): string | null {
  const parts: string[] = [];
  if (view.filter.pipelines.length > 0) parts.push(`pipelines ${view.filter.pipelines.join(', ')}`);
  if (view.scope === 'global') {
    if (view.filter.projects.length > 0) parts.push(`projects ${view.filter.projects.join(', ')}`);
    if (view.filter.tags?.length > 0) parts.push(`tags ${view.filter.tags.join(', ')}`);
  } else if (view.filter.tags.length > 0) {
    const names = new Map(view.filterTags.map((tag) => [tag.id, tag.name]));
    parts.push(`tags ${view.filter.tags.map((id) => names.get(id) ?? id).join(', ')}`);
  }
  return parts.length === 0 ? null : parts.join('; ');
}

/** The slug of the project of a global queue entry, as a prefix. */
type Slugs = (repository: string | undefined) => string;

function queueRunLines(
  runs: (QueueView | GlobalQueueView)['runs'],
  style: Style,
  slug: Slugs,
): string[] {
  const lines: string[] = [];
  for (const run of runs) {
    const progress =
      run.groups.total === 0
        ? 'splitting'
        : `${run.groups.done}/${run.groups.total} groups · steps ${run.steps.done}/${run.steps.total}`;
    const delivering = `${run.delivering ? ' · delivering' : ''}${run.priority ? ' · priority' : ''}`;
    lines.push(
      `  ${slug('repository' in run ? run.repository : undefined)}${taskNumber(run.number)} ${style.accent(run.id)}  ${statusBadge(run.state, style)}  ${runPipelineLabel(run)}  ${withTags(run.title, run.tags, style)}  ${progress}${delivering}`,
    );
    for (const active of run.active) {
      lines.push(
        `    ${active.group}${(active.stepName ?? active.step) ? `: ${active.stepName ?? active.step}` : ''}`,
      );
    }
    for (const held of run.waiting ?? []) {
      lines.push(
        `    ${held.group}${(held.stepName ?? held.step) ? `: ${held.stepName ?? held.step}` : ''} (${waitNote(held.wait, false)})`,
      );
    }
    if (run.problem) {
      lines.push(
        style.danger(
          `    problem: ${run.problem.reason}${run.problem.group ? ` in ${run.problem.group}` : ''}`,
        ),
      );
    }
  }
  return lines;
}

/** ` · after …`: the predecessors of a task; those of other projects carry the slug of their project. */
function afterText(
  after: QueueView['items'][number]['after'],
  view: QueueView | GlobalQueueView,
  slugs: ReadonlyMap<string, string>,
  mark: string,
): string {
  if (after.length === 0) return '';
  const own = 'repository' in view ? view.repository : null;
  const names = after.map((dependency) => {
    const slug =
      dependency.repository !== null && dependency.repository !== own
        ? slugs.get(dependency.repository)
        : undefined;
    if (slug !== undefined) return `${slug}:${dependency.id}`;
    return dependency.number === null
      ? dependency.id
      : `${taskNumber(dependency.number)} ${dependency.id}`;
  });
  return ` · after ${names.join(', ')}${mark}`;
}

/** The first line: the state, the places and the modes. */
function queueHead(view: QueueView | GlobalQueueView, style: Style): string {
  const places = `parallel ${view.parallel} (${view.runs.length} of ${view.parallel} places taken)`;
  const name =
    view.scope === 'global'
      ? `${style.muted('Global queue:')} ${statusBadge(view.status, style)}, ${places}, at most ${view.max} specialists at once`
      : `${style.muted('Queue:')} ${statusBadge(view.status, style)}, ${places}`;
  const modes = `autopilot ${view.autopilot ? 'on' : 'off'}, auto answer ${view.autoAnswer ? 'on' : 'off'}, skip failed ${view.skipFailed ? 'on' : 'off'}`;
  return `${name}, ${modes}${view.onLimit === 'stop' ? ', on limit stop' : ''}`;
}

export function formatQueue(
  view: QueueView | GlobalQueueView,
  style: Style = plainStyle,
  repositories: readonly RepositoryView[] = [],
): string {
  const slugs = new Map(repositories.map((repository) => [repository.path, repository.slug]));
  const global = view.scope === 'global';
  const slug: Slugs = (repository) =>
    global && repository !== undefined ? `[${slugs.get(repository) ?? repository}] ` : '';
  const lines = [queueHead(view, style)];
  const own = 'repository' in view ? view.repository : null;
  if (view.autopilotAnswer !== null) {
    lines.push(`${style.muted('Autopilot answer:')} ${firstLine(view.autopilotAnswer)}`);
  }
  const filter = filterLine(view);
  if (filter !== null) lines.push(`${style.muted('Filter:')} ${filter}`);
  const reason = stopReason(view);
  if (reason) lines.push(style.danger(`Stopped: ${reason}`));
  if (view.runs.length > 0) {
    lines.push(style.muted('Runs holding a place:'));
    lines.push(...queueRunLines(view.runs, style, slug));
  }
  if (view.skipped.length > 0) {
    lines.push(style.muted('Skipped with a problem:'));
    lines.push(...queueRunLines(view.skipped, style, slug));
  }
  if (view.items.length === 0) {
    lines.push('No tasks waiting.');
    return lines.join('\n');
  }
  lines.push(style.muted('Waiting:'));
  for (const item of view.items) {
    const body = item.groups
      ? `${item.groups.length} ${item.groups.length === 1 ? 'group' : 'groups'}`
      : firstLine(item.task ?? '');
    const title = item.title ? ` [${item.title}]` : '';
    const labels = formatTagLabels(item.tags, style);
    const tagText = labels === '' ? '' : `  ${labels}`;
    const delivery =
      (item.autoDeliver === null
        ? ''
        : item.autoDeliver
          ? ' · auto delivery'
          : ' · manual delivery') +
      (item.deliveryMode === null ? '' : ` · delivery: ${item.deliveryMode}`);
    const variant = item.variant === 'default' ? '' : ` · variant: ${item.variant}`;
    const provider =
      item.provider === null
        ? ''
        : ` · provider: ${providerText(item.provider, item.providerName)}`;
    const skipped = item.skip.length === 0 ? '' : ` · skip: ${item.skip.join(', ')}`;
    const mark =
      item.readiness === 'ready'
        ? ''
        : ` (${item.readiness === 'blocked' ? style.danger('blocked') : item.readiness})`;
    const after = afterText(item.after, view, slugs, mark);
    const links = formatLinks(item.links, item.linkedBy, (repository) =>
      repository !== null && repository !== own ? slugs.get(repository) : undefined,
    );
    const postponed =
      (item.postponed ? ' · postponed' : '') + (item.filtered ? ' · filtered out' : '');
    const files = item.attachments.length === 0 ? '' : ` · attachments: ${item.attachments.length}`;
    const error = item.error ? style.danger(` — error: ${item.error}`) : '';
    const returned =
      item.run === null ? '' : ` · ${item.hold ?? 'returns'} ${style.accent(item.run)}`;
    const head = `  ${item.position}. ${slug('repository' in item ? item.repository : undefined)}${taskNumber(item.number)} ${style.accent(item.id)}  ${pipelineLabel(item.pipeline, item.pipelineName)}  `;
    const tail = `${title}${tagText}${delivery}${variant}${provider}${skipped}${after}${links}${files}${postponed}${returned}  added ${addedAt(item.createdAt)}${error}`;
    const room = isTerminal(style)
      ? Math.max(10, style.columns - visibleWidth(head) - visibleWidth(tail))
      : Infinity;
    lines.push(`${head}${truncateVisible(body, room)}${tail}`);
  }
  return lines.join('\n');
}

/** The queues of several projects, each under a heading with the name and slug of its project. */
export function formatQueues(
  views: readonly QueueView[],
  registry: readonly RepositoryView[],
  style: Style = plainStyle,
): string {
  if (views.length === 0) return 'No enabled projects';
  return views
    .map((view) => {
      const entry = registry.find((candidate) => candidate.path === view.repository);
      const heading = entry ? `${entry.label} (${entry.slug})` : view.repository;
      return `${style.accent(heading)}\n${formatQueue(view, style)}`;
    })
    .join('\n\n');
}

export function formatRepositories(
  repositories: readonly RepositoryView[],
  style: Style = plainStyle,
): string {
  if (repositories.length === 0) return 'No repositories yet.';
  return table(
    [
      ['SLUG', 'NAME', 'REPOSITORY', 'STATE', 'UNFINISHED', 'WAITING', 'QUEUED'],
      ...repositories.map((entry) => [
        entry.slug,
        entry.label,
        entry.path,
        entry.enabled ? 'on' : 'off',
        String(entry.unfinished),
        String(entry.waiting),
        String(entry.queued),
      ]),
    ],
    style,
  );
}

/** One line per project of a task added to several projects: slug, item id, task number. */
export function formatAddedToProjects(
  added: readonly AddedToProjectView[],
  style: Style = plainStyle,
): string {
  const width = Math.max(...added.map((entry) => entry.project.length));
  return added
    .map(
      (entry) =>
        `${entry.project.padEnd(width)}  ${style.accent(entry.item)}  ${taskNumber(entry.number)}`,
    )
    .join('\n');
}
