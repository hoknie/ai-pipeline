import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { rejected } from '../../../platform/errors/index.ts';
import {
  changedPathsBetween,
  changedPathsSince,
  diffStat,
  fileDiff,
  git,
  readFileAt,
  refExists,
  type DiffStat,
} from '../../../platform/git/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import {
  findGroup,
  groupRef,
  isServiceGroup,
  runRef,
  type Group,
  type RunState,
} from '../../runs/types/index.ts';
import type { DeliveryPublishPort } from '../ports/index.ts';
import { pickSpecChange, type FileDiffView, type GroupSpecView } from '../types/index.ts';

const FILE_DIFF_CONTEXT = 5;
const FILE_DIFF_MAX_LINES = 2000;

/** The statistics of a group with the commit range they were taken from. */
export type GroupDiffStat = DiffStat & { revision: string };

export interface DiffDependencies {
  runs: Pick<RunsServices, 'reads' | 'effects'>;
  publish: DeliveryPublishPort;
}

/** The commits a group's changes lie between, or null when they are not recorded yet. */
async function groupRange(state: RunState, group: Group): Promise<[string, string] | null> {
  const { repository } = state.run;
  if (group.status === 'merged' && group.mergeCommit) {
    return [`${group.mergeCommit}^1`, group.mergeCommit];
  }
  const ref = groupRef(state.run, group.slug);
  const run = runRef(state.run);
  if ((await refExists(repository, ref)) && (await refExists(repository, run))) {
    return [await git(repository, 'merge-base', run, ref), ref];
  }
  return null;
}

function readInTree(worktree: string, path: string): Promise<string | null> {
  try {
    return Promise.resolve(readFileSync(join(worktree, path), 'utf8'));
  } catch {
    return Promise.resolve(null);
  }
}

/** The diffs of the groups: statistics computed in the background, files and OpenSpec documents. */
export class DiffService {
  private readonly dependencies: DiffDependencies;
  private readonly diffs = new Map<string, GroupDiffStat>();
  private readonly diffing = new Set<string>();
  private readonly again = new Set<string>();

  constructor(dependencies: DiffDependencies) {
    this.dependencies = dependencies;
  }

  /** The statistics of a group, or null while they are unknown. */
  diffOf(runId: string, slug: string): GroupDiffStat | null {
    return this.diffs.get(`${runId}/${slug}`) ?? null;
  }

  /** Computes missing diff statistics of a run in the background, then publishes them. */
  ensure(state: RunState): void {
    for (const group of state.groups) {
      const key = `${state.run.id}/${group.slug}`;
      if (group.attempts.length === 0 || this.diffs.has(key) || this.diffing.has(key)) continue;
      void this.refresh(state, group.slug);
    }
  }

  async refresh(state: RunState, slug: string): Promise<void> {
    const key = `${state.run.id}/${slug}`;
    const group = findGroup(state, slug);
    if (!group) return;
    if (this.diffing.has(key)) {
      this.again.add(key);
      return;
    }
    this.diffing.add(key);
    try {
      const { repository } = state.run;
      const range = await groupRange(state, group);
      if (range === null) return;
      const from = await git(repository, 'rev-parse', range[0]);
      const to = await git(repository, 'rev-parse', range[1]);
      const stat = await diffStat(repository, from, to);
      this.diffs.set(key, { ...stat, revision: `${from}..${to}` });
      this.dependencies.publish.runChanged(state);
    } catch {
      // the commits are gone (for example after git gc); leave the statistics unknown
    } finally {
      this.diffing.delete(key);
      if (this.again.delete(key)) void this.refresh(state, slug);
    }
  }

  /** The documents of the OpenSpec change the group made or is making. */
  async spec(runId: string, slug: string): Promise<GroupSpecView | null> {
    const { state, group } = this.dependencies.runs.reads.groupOf(runId, slug);
    if (isServiceGroup(group)) return null;
    const { repository } = state.run;
    const pathspec = 'openspec/changes';
    try {
      const worktree = this.dependencies.runs.effects.worktreePath(state, group);
      let paths: string[];
      let read: (path: string) => Promise<string | null>;
      if (group.status !== 'merged' && existsSync(worktree)) {
        const base = await git(worktree, 'merge-base', runRef(state.run), 'HEAD');
        paths = await changedPathsSince(worktree, base, pathspec);
        read = (path) => readInTree(worktree, path);
      } else {
        const range = await groupRange(state, group);
        if (range === null) return null;
        paths = await changedPathsBetween(repository, range[0], range[1], pathspec);
        read = (path) => readFileAt(repository, range[1], path);
      }
      for (const candidate of pickSpecChange(paths)) {
        const design = await read(`${candidate.path}/design.md`);
        const tasks = await read(`${candidate.path}/tasks.md`);
        if (design !== null || tasks !== null) return { ...candidate, design, tasks };
      }
    } catch {
      // the worktree or the commits are gone; show no change
    }
    return null;
  }

  /** The diff of one changed file of a group. */
  async fileDiff(params: { runId: string; group: string; path: string }): Promise<FileDiffView> {
    const { runId, group: slug, path } = params;
    const { state, group } = this.dependencies.runs.reads.groupOf(runId, slug);
    const key = `${state.run.id}/${group.slug}`;
    if (!this.diffs.has(key)) await this.refresh(state, group.slug);
    const stat = this.diffs.get(key);
    if (!stat) throw rejected(`the diff of group ${group.slug} is not available`);
    const file = stat.files.find((entry) => entry.path === path);
    if (!file) throw rejected(`${path} is not changed in group ${group.slug}`);
    const previousPath = file.previousPath ?? null;
    if (file.added === null) {
      return {
        path: file.path,
        previousPath,
        binary: true,
        lines: [],
        totalLines: 0,
        truncated: false,
      };
    }
    try {
      const range = await groupRange(state, group);
      if (range === null) throw new Error('refs are removed');
      const diff = await fileDiff(
        state.run.repository,
        range[0],
        range[1],
        previousPath ? [previousPath, file.path] : [file.path],
        { context: FILE_DIFF_CONTEXT, maxLines: FILE_DIFF_MAX_LINES },
      );
      return { path: file.path, previousPath, binary: false, ...diff };
    } catch {
      throw rejected(`the diff of ${path} is not available`);
    }
  }
}
