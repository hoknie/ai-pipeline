import { type Style, plainStyle } from './style.ts';
import { table } from './table.ts';
import type { RunView, TagView } from '../ipc/contract/index.ts';

/** Labels `#name` separated by spaces; empty without tags. */
export function formatTagLabels(
  tags: readonly TagView[] | undefined,
  style: Style = plainStyle,
): string {
  return (tags ?? [])
    .map((tag) => style.argument(tag.task ? `#${tag.name}→#${tag.task.number}` : `#${tag.name}`))
    .join(' ');
}

/** Keeps the runs that have at least one of the tags; names compare ignoring case. */
export function filterByTags(runs: readonly RunView[], names: readonly string[]): RunView[] {
  const wanted = new Set(names.map((name) => name.trim().toLocaleLowerCase('und')));
  return runs.filter((run) =>
    (run.tags ?? []).some((tag) => wanted.has(tag.name.toLocaleLowerCase('und'))),
  );
}

export function formatTagList(tags: readonly TagView[], style: Style = plainStyle): string {
  if (tags.length === 0) return 'No tags yet.';
  return table(
    [
      ['NAME', 'COLOR', 'TASK'],
      ...tags.map((tag) => [
        style.argument(tag.name),
        tag.color,
        tag.task ? `#${tag.task.number}` : '—',
      ]),
    ],
    style,
  );
}
