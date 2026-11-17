import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { conversationName } from '../../../agents/types/index.ts';
import type { Runtime as RuntimeName } from '../../../swarm-config/types/index.ts';
import { attemptDirectory } from '../../../../platform/git/index.ts';
import type { Specialist } from '../../../swarm-config/types/index.ts';
import {
  SPLIT_GROUP,
  findGroup,
  isRepairGroup,
  type Attempt,
  type Group,
  type RunState,
} from '../../types/index.ts';

import { workspaceOf } from './worktrees.ts';

/**
 * The private state of the conversation of an attempt: the folder of its group, then the step, the
 * generation and the runtime. Null for an attempt of a runtime without a conversation.
 */
export function conversationFolder(
  state: RunState,
  group: string,
  attempt: Attempt,
): string | null {
  if (attempt.generation === null) return null;
  const name = conversationName(attempt.stepId, attempt.generation, attempt.runtime as RuntimeName);
  const anyAttempt = attemptDirectory(workspaceOf(state), state.run.id, group, attempt.seq);
  return join(anyAttempt, '..', 'conversations', name);
}

/** Removes every conversation of a merged group. */
export function purgeGroupConversations(state: RunState, groupSlug: string): void {
  const group = findGroup(state, groupSlug);
  if (group?.status !== 'merged') return;
  for (const item of group.attempts) {
    const folder = conversationFolder(state, groupSlug, item);
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Removes the private state of a conversation that cannot resume any more: a step that ended with
 * `done` or `rejected` (a review keeps it), and every conversation of a merged group (a failed or
 * cancelled group may be retried). A conversation that waits for a person, a limit or a restart of
 * the daemon is kept.
 */
export function purgeConversations(state: RunState, groupSlug: string, seq: number): void {
  const group = findGroup(state, groupSlug);
  const attempt = group?.attempts.find((item) => item.seq === seq);
  if (!group || !attempt) return;
  const remove = (item: Attempt): void => {
    const folder = conversationFolder(state, groupSlug, item);
    if (folder) rmSync(folder, { recursive: true, force: true });
  };
  if (group.status === 'merged') {
    purgeGroupConversations(state, groupSlug);
    return;
  }
  const verdict = attempt.report?.verdict;
  if (
    attempt.status === 'finished' &&
    (verdict === 'done' || verdict === 'rejected') &&
    !attempt.input.humanReview
  ) {
    remove(attempt);
  }
}

/** The specialist as the attempt runs it: the runtime, model and variant the chain chose. */
export function effectiveSpecialist(specialist: Specialist, attempt: Attempt): Specialist {
  return {
    ...specialist,
    runtime: attempt.runtime as Specialist['runtime'],
    model: attempt.model,
    ...(attempt.variant !== undefined ? { variant: attempt.variant } : {}),
    ...(attempt.reasoningEffort !== undefined ? { reasoningEffort: attempt.reasoningEffort } : {}),
  };
}

/** The command of the worker MCP server of one attempt; its token is valid for this attempt only. */
export function workerCommand(
  entry: string[],
  token: string,
  socket: string,
  group: Group,
  specialist: Specialist,
): string[] {
  return [
    ...entry,
    'mcp',
    '--worker',
    token,
    '--socket',
    socket,
    ...(group.slug === SPLIT_GROUP ? ['--split'] : []),
    ...(specialist.queue === true ? ['--queue'] : []),
    ...(isRepairGroup(group) ? ['--repair'] : []),
  ];
}
