import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { conversationName } from '../../../agents/types/index.ts';
import type { Runtime as RuntimeName } from '../../../swarm-config/types/index.ts';
import { attemptDirectory } from '../../../../platform/git/index.ts';
import { expandMcpServers } from '../../../agents/types/index.ts';
import type { McpServer, Specialist } from '../../../swarm-config/types/index.ts';
import type { AttemptExit } from '../../machine/events.ts';
import type { RemoteMcpPort } from '../../ports/index.ts';
import {
  SPLIT_GROUP,
  findGroup,
  isRepairGroup,
  specialistOfStep,
  stepsOf,
  type Attempt,
  type Group,
  type RunState,
} from '../../types/index.ts';

import type { EffectDependencies } from './context.ts';
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

/**
 * The servers that go through a connection become ordinary stdio servers of the agent: the bridge
 * of this attempt (`aip mcp --remote <name>`), which knows the token of the attempt and nothing of
 * the connection. The servers with a command stay as they are.
 */
export function bridgedServers(
  servers: Readonly<Record<string, McpServer>>,
  entry: string[],
  token: string,
  socket: string,
): Record<string, McpServer> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [
      name,
      server.connection === undefined
        ? server
        : {
            command: entry[0] ?? 'aip',
            args: [
              ...entry.slice(1),
              'mcp',
              '--remote',
              name,
              '--worker',
              token,
              '--socket',
              socket,
            ],
            env: {},
          },
    ]),
  );
}

/** The specialist with its connection servers replaced by the bridge of the attempt. */
export function withBridges(
  specialist: Specialist,
  entry: string[],
  token: string,
  socket: string,
): Specialist {
  if (specialist.mcp === undefined) return specialist;
  return { ...specialist, mcp: bridgedServers(specialist.mcp, entry, token, socket) };
}

/**
 * The refusal to start for a server whose connection does not serve the project, or null. The
 * text names the server and the connection, never a secret.
 */
export function unavailableConnection(
  port: RemoteMcpPort,
  project: string,
  servers: Readonly<Record<string, McpServer>>,
): string | null {
  for (const [name, server] of Object.entries(servers)) {
    if (server.connection === undefined) continue;
    const found = port.resolve(project, server.connection);
    if (found.ok) continue;
    return found.reason === 'disabled'
      ? `MCP server ${name}: connection ${server.connection} is disabled`
      : `MCP server ${name}: connection ${server.connection} is not available for this project`;
  }
  return null;
}

/**
 * The specialist with `${NAME}` of its MCP servers replaced and every connection checked, or the
 * reason the attempt cannot start. The snapshot of the run keeps the text: this is the only place.
 */
export function connectedSpecialist(
  port: RemoteMcpPort,
  project: string,
  specialist: Specialist,
  variables: Readonly<Record<string, string | undefined>>,
): { specialist: Specialist } | { error: string } {
  if (specialist.mcp === undefined) return { specialist };
  const expanded = expandMcpServers(specialist.mcp, variables);
  if (!expanded.ok) return { error: expanded.error };
  const refused = unavailableConnection(port, project, expanded.servers);
  return refused === null
    ? { specialist: { ...specialist, mcp: expanded.servers } }
    : { error: refused };
}

/**
 * The servers of a specialist that go through a connection: where the registry may name the
 * project of the run.
 */
export function connectionServers(
  specialist: Specialist,
): { server: string; connection: string }[] {
  return Object.entries(specialist.mcp ?? {}).flatMap(([server, one]) =>
    one.connection === undefined ? [] : [{ server, connection: one.connection }],
  );
}

/**
 * The project of the service registry the run's project is linked to. The wait is bounded and a
 * failure or a silence is null. Runs outside the queue of the engine.
 */
export async function lookupRegistryProject(
  dependencies: Pick<EffectDependencies, 'registryProject' | 'timings'>,
  repository: string,
  servers: { server: string; connection: string }[],
): Promise<Awaited<ReturnType<EffectDependencies['registryProject']['projectFor']>>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dependencies.registryProject.projectFor(repository, servers),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), dependencies.timings.registryProjectMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The servers through a connection of an attempt that has not been told its project yet. */
function registryServers(
  state: RunState,
  slug: string,
  seq: number,
): { server: string; connection: string }[] {
  const group = findGroup(state, slug);
  const attempt = group?.attempts.find((candidate) => candidate.seq === seq);
  if (!group || !attempt || attempt.runtime === 'command') return [];
  if (attempt.input.registryProject !== undefined) return [];
  const step = stepsOf(state.run, group)[attempt.stepIndex];
  const specialist = specialistOfStep(state.run, group, step ?? { specialist: attempt.specialist });
  return specialist ? connectionServers(specialist) : [];
}

/**
 * Starts an attempt through `startNow`. When a server of its specialist goes through a connection
 * and the input has no registry project yet, the wait for the registry happens outside the queue:
 * the queue moves on and the attempt continues in it once the answer (or the timeout) is there.
 */
export async function startWithRegistryProject(
  dependencies: Pick<EffectDependencies, 'context' | 'registryProject' | 'timings'>,
  state: RunState,
  slug: string,
  seq: number,
  startNow: () => Promise<void>,
): Promise<void> {
  const servers = registryServers(state, slug, seq);
  if (servers.length === 0) return startNow();
  const { context } = dependencies;
  void lookupRegistryProject(dependencies, state.run.repository, servers)
    .then((answer) =>
      context.stopping
        ? undefined
        : context.serial(async () => {
            if (context.stopping) return;
            const attempt = findGroup(state, slug)?.attempts.find((item) => item.seq === seq);
            // Cancelled, finished or started while the registry was asked: nothing to start.
            if (attempt?.status !== 'running') return;
            const exitWith = (failure: AttemptExit['failure']): Promise<void> =>
              context.apply(state, {
                kind: 'attempt_exited',
                group: slug,
                seq,
                exit: { sessionId: null, usage: null, failure, outsideChanges: [] },
              });
            try {
              if (attempt.reason !== null) {
                // A pause or a message came while the registry was asked: no process exists to
                // stop, so the attempt ends as if it had been stopped, and the machine goes on.
                await exitWith(null);
                return;
              }
              if (answer !== null) {
                await context.apply(state, {
                  kind: 'registry_project_resolved',
                  group: slug,
                  seq,
                  registryProject: answer,
                });
              }
              await startNow();
            } catch (error) {
              const current = findGroup(state, slug)?.attempts.find((item) => item.seq === seq);
              if (current?.status !== 'running') return;
              await exitWith({ kind: 'spawn', message: (error as Error).message });
            }
          }),
    )
    .catch(() => undefined);
  return undefined;
}
