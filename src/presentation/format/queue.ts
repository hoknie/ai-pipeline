import { clockTime } from '../../feature/runs/types/index.ts';
import { waitNote, withTags } from './runs.ts';
import { type Style, plainStyle, statusBadge } from './style.ts';
import { addedAt, firstLine, pipelineLabel, table, taskNumber } from './table.ts';
import { formatTagLabels } from './tags.ts';
import type { QueueView, RepositoryView } from '../ipc/contract/index.ts';

function stopReason(view: QueueView): string | null {
  const stop = view.stop;
  if (!stop) return null;
  if (stop.kind === 'item') return `item ${stop.item}: ${stop.error}`;
  if (stop.kind === 'limit') {
    const resumes = stop.autoResume ? ', resumes automatically' : '';
    return `usage limit of ${stop.runtime} in ${stop.run}, resets ${clockTime(stop.resetsAt)}${resumes}`;
  }
  const where = stop.group ? `run ${stop.run}, group ${stop.group}` : `run ${stop.run}`;
  return `${where}: ${stop.reason}`;
}

function filterLine(view: QueueView): string | null {
  const names = new Map(view.filterTags.map((tag) => [tag.id, tag.name]));
  const parts: string[] = [];
  if (view.filter.pipelines.length > 0) parts.push(`pipelines ${view.filter.pipelines.join(', ')}`);
  if (view.filter.tags.length > 0) {
    parts.push(`tags ${view.filter.tags.map((id) => names.get(id) ?? id).join(', ')}`);
  }
  return parts.length === 0 ? null : parts.join('; ');
}

function queueRunLines(runs: QueueView['runs'], style: Style): string[] {
  const lines: string[] = [];
  for (const run of runs) {
    const progress =
      run.groups.total === 0
        ? 'splitting'
        : `${run.groups.done}/${run.groups.total} groups · steps ${run.steps.done}/${run.steps.total}`;
    const delivering = `${run.delivering ? ' · delivering' : ''}${run.priority ? ' · priority' : ''}`;
    lines.push(
      `  ${taskNumber(run.number)} ${style.accent(run.id)}  ${statusBadge(run.state, style)}  ${pipelineLabel(run.pipeline, run.pipelineName)}  ${withTags(run.title, run.tags, style)}  ${progress}${delivering}`,
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

export function formatQueue(view: QueueView, style: Style = plainStyle): string {
  const lines = [
    `${style.muted('Queue:')} ${statusBadge(view.status, style)}, parallel ${view.parallel} (${view.runs.length} of ${view.parallel} places taken), autopilot ${view.autopilot ? 'on' : 'off'}, auto answer ${view.autoAnswer ? 'on' : 'off'}, skip failed ${view.skipFailed ? 'on' : 'off'}${view.onLimit === 'stop' ? ', on limit stop' : ''}`,
  ];
  if (view.autopilotAnswer !== null) {
    lines.push(`${style.muted('Autopilot answer:')} ${firstLine(view.autopilotAnswer)}`);
  }
  const filter = filterLine(view);
  if (filter !== null) lines.push(`${style.muted('Filter:')} ${filter}`);
  const reason = stopReason(view);
  if (reason) lines.push(style.danger(`Stopped: ${reason}`));
  if (view.runs.length > 0) {
    lines.push(style.muted('Runs holding a place:'));
    lines.push(...queueRunLines(view.runs, style));
  }
  if (view.skipped.length > 0) {
    lines.push(style.muted('Skipped with a problem:'));
    lines.push(...queueRunLines(view.skipped, style));
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
    const skipped = item.skip.length === 0 ? '' : ` · skip: ${item.skip.join(', ')}`;
    const mark =
      item.readiness === 'ready'
        ? ''
        : ` (${item.readiness === 'blocked' ? style.danger('blocked') : item.readiness})`;
    const after =
      item.after.length === 0
        ? ''
        : ` · after ${item.after
            .map((dependency) =>
              dependency.number === null
                ? dependency.id
                : `${taskNumber(dependency.number)} ${dependency.id}`,
            )
            .join(', ')}${mark}`;
    const postponed =
      (item.postponed ? ' · postponed' : '') + (item.filtered ? ' · filtered out' : '');
    const error = item.error ? style.danger(` — error: ${item.error}`) : '';
    const returned =
      item.run === null ? '' : ` · ${item.hold ?? 'returns'} ${style.accent(item.run)}`;
    lines.push(
      `  ${item.position}. ${taskNumber(item.number)} ${style.accent(item.id)}  ${pipelineLabel(item.pipeline, item.pipelineName)}  ${body}${title}${tagText}${delivery}${skipped}${after}${postponed}${returned}  added ${addedAt(item.createdAt)}${error}`,
    );
  }
  return lines.join('\n');
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
