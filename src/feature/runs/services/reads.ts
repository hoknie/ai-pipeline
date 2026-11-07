import { rejected } from '../../../platform/errors/index.ts';
import { readLines, readTail, readTimes, timesPath } from '../../agents/services/index.ts';
import type { AgentsService } from '../../agents/services/index.ts';
import type { AgentTranscript, TranscriptEntry } from '../../agents/types/index.ts';
import { findGroup, type Group, type RunState } from '../types/index.ts';

import type { RunEffects } from './effects/effects.ts';
import type { RunStates } from './states.ts';

/** A group with what the panel shows next to it: its tree and the tail of its last log. */
export interface GroupDetails {
  state: RunState;
  group: Group;
  worktree: string;
  log: { seq: number; lines: string[] } | null;
}

/** Reads of a run that need the files of its attempts. */
export class RunReads {
  private readonly dependencies: { states: RunStates; effects: RunEffects; agents: AgentsService };

  constructor(dependencies: { states: RunStates; effects: RunEffects; agents: AgentsService }) {
    this.dependencies = dependencies;
  }

  /** The group of the run; throws when there is none. */
  groupOf(runId: string, slug: string): { state: RunState; group: Group } {
    const state = this.dependencies.states.get(runId);
    const group = findGroup(state, slug);
    if (!group) throw rejected(`unknown group \`${slug}\` in run ${runId}`);
    return { state, group };
  }

  group(runId: string, slug: string, tailLines = 40): GroupDetails {
    const { state, group } = this.groupOf(runId, slug);
    const { effects } = this.dependencies;
    const last = group.attempts.at(-1);
    const log = last
      ? { seq: last.seq, lines: readTail(effects.logPath(state, group.slug, last.seq), tailLines) }
      : null;
    return { state, group, worktree: effects.worktreePath(state, group), log };
  }

  /** The readable entries of an attempt log, from line `after` on. */
  transcript(params: {
    runId: string;
    group: string;
    seq?: number | undefined;
    after?: number | undefined;
  }): AgentTranscript {
    const { state, group } = this.groupOf(params.runId, params.group);
    const attempt =
      params.seq === undefined
        ? group.attempts.at(-1)
        : group.attempts.find((candidate) => candidate.seq === params.seq);
    if (params.seq !== undefined && !attempt) {
      throw rejected(`unknown attempt ${params.seq} of group \`${params.group}\``);
    }
    const base = { runId: state.run.id, group: group.slug };
    if (!attempt) return { ...base, seq: null, cursor: 0, running: false, entries: [] };
    const logPath = this.dependencies.effects.logPath(state, group.slug, attempt.seq);
    const after = params.after ?? 0;
    const { lines, cursor } = readLines(logPath, after);
    const moments = readTimes(timesPath(logPath));
    const times = lines.map((_, index) => moments.get(after + index) ?? null);
    const entries: TranscriptEntry[] =
      attempt.runtime === 'command'
        ? lines.flatMap((text, index): TranscriptEntry[] =>
            text === '' ? [] : [{ kind: 'raw', text, at: times[index] ?? null }],
          )
        : this.dependencies.agents.runtimeFor(attempt.runtime).transcript(lines, times);
    const verdict = attempt.report?.verdict ?? null;
    for (const entry of entries) if (entry.kind === 'result') entry.verdict = verdict;
    return { ...base, seq: attempt.seq, cursor, running: attempt.status === 'running', entries };
  }
}
