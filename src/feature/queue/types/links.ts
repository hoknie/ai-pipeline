import { rejected } from '../../../platform/errors/index.ts';
import type { DependencyState } from './dependencies.ts';

export const LINK_KINDS = ['blocked_by', 'parent', 'related', 'duplicates'] as const;

export type LinkKind = (typeof LINK_KINDS)[number];

/** A link of a task: the source (an item or a run) points at the target. */
export interface TaskLink {
  source: string;
  kind: LinkKind;
  target: string;
}

/** A link as a client writes it: the target is an id or a task number, the kind is unchecked. */
export interface LinkInput {
  kind: string;
  target: string | number;
}

/** What a view knows about the other end of a link. */
export interface TaskRefInfo {
  /** `null`: a run that is not in the database. */
  ref: 'item' | 'run' | null;
  number: number | null;
  title: string;
  /** The root of the repository of the task; `null` for an unknown one. */
  repository: string | null;
}

/** An entry of `links` or `linkedBy` of a task. */
export interface TaskLinkView extends TaskRefInfo {
  kind: LinkKind;
  id: string;
  /** Only for `blocked_by` in `links`: the state of the predecessor. */
  state?: DependencyState | undefined;
}

export function isLinkKind(kind: string): kind is LinkKind {
  return (LINK_KINDS as readonly string[]).includes(kind);
}

export function checkLinkKind(kind: string): LinkKind {
  if (!isLinkKind(kind)) throw rejected(`unknown link kind \`${kind}\``);
  return kind;
}

/** The identity of a link: `related` has no direction. */
function linkKey(link: TaskLink): string {
  if (link.kind !== 'related') return `${link.kind}\0${link.source}\0${link.target}`;
  const [first, second] = [link.source, link.target].sort();
  return `related\0${first}\0${second}`;
}

/** Collapses repeated links, keeping the first; `related` A↔B and B↔A are one link. */
export function normalizeLinks(links: readonly TaskLink[]): TaskLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = linkKey(link);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Rejects the links of `source` that point at itself, give it a second parent, or block a started
 * task (`started`) with a new `blocked_by`.
 */
export function checkLinks(source: string, links: readonly TaskLink[], started: boolean): void {
  if (links.some((link) => link.target === source)) {
    throw rejected('a task cannot link to itself');
  }
  if (links.filter((link) => link.kind === 'parent').length > 1) {
    throw rejected('a task has only one parent');
  }
  if (started && links.some((link) => link.kind === 'blocked_by')) {
    throw rejected('a started task cannot be blocked');
  }
}

/**
 * Rejects `parent` as the parent of `source` when the chain of parents above it leads back to
 * `source`. `parentOf` gives the parent of a task, if it has one.
 */
export function checkParentCycle(
  parentOf: (id: string) => string | undefined,
  source: string,
  parent: string,
): void {
  const path = [source];
  let current: string | undefined = parent;
  while (current !== undefined) {
    const seen = path.includes(current);
    path.push(current);
    if (current === source) throw rejected(`parent cycle: ${path.join(' → ')}`);
    if (seen) return;
    current = parentOf(current);
  }
}

/**
 * The `links` and `linkedBy` of a task from the links `out` of it and `into` it. `related` shows on both sides
 * as `links` and never as `linkedBy`. `describe` turns the other end into the view.
 */
export function linkViews(
  all: { out: readonly TaskLink[]; into: readonly TaskLink[] },
  describe: (other: string, link: TaskLink, outgoing: boolean) => Omit<TaskLinkView, 'kind' | 'id'>,
): { links: TaskLinkView[]; linkedBy: TaskLinkView[] } {
  const view = (link: TaskLink, other: string, outgoing: boolean): TaskLinkView => ({
    kind: link.kind,
    id: other,
    ...describe(other, link, outgoing),
  });
  const links = [
    ...all.out.map((link) => view(link, link.target, true)),
    ...all.into
      .filter((link) => link.kind === 'related')
      .map((link) => view(link, link.source, false)),
  ];
  const linkedBy = all.into
    .filter((link) => link.kind !== 'related')
    .map((link) => view(link, link.source, false));
  return { links, linkedBy };
}

/** The links a new task asks for, resolved: ids of items and runs. */
export interface LinkPlan {
  after: string[];
  parent: string | null;
  others: { kind: 'related' | 'duplicates'; target: string }[];
}

/** The links of a new task: `blocked_by` first, then `parent`, then the rest; one parent at most. */
export function resolveLinks(
  resolve: (ref: string | number) => string,
  inputs: readonly LinkInput[],
): LinkPlan {
  const kinds = inputs.map((input) => checkLinkKind(input.kind));
  const take = (wanted: (kind: LinkKind) => boolean) =>
    inputs.flatMap((input, index) => {
      const kind = kinds[index] as LinkKind;
      return wanted(kind) ? [{ kind, id: resolve(input.target) }] : [];
    });
  const blocked = take((kind) => kind === 'blocked_by');
  const parents = take((kind) => kind === 'parent');
  const others = take((kind) => kind === 'related' || kind === 'duplicates');
  if (new Set(parents.map((link) => link.id)).size > 1) {
    throw rejected('a task has only one parent');
  }
  return {
    after: [...new Set(blocked.map((link) => link.id))],
    parent: parents[0]?.id ?? null,
    others: others.map((link) => ({
      kind: link.kind as 'related' | 'duplicates',
      target: link.id,
    })),
  };
}
