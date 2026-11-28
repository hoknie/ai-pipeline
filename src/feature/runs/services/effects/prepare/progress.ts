import type { Specialist } from '../../../../swarm-config/types/index.ts';
import type { RunState } from '../../../types/index.ts';
import type { AttemptKey, EffectDependencies, Prepared } from '../context.ts';
import { connectedSpecialist } from '../conversations.ts';

/** The specialist ready to start (servers expanded, connections checked); null when refused. */
export async function withServers(
  dependencies: EffectDependencies,
  state: RunState,
  key: AttemptKey,
  runtimeName: string,
  specialist: Specialist,
  settings: Readonly<Record<string, { env: Readonly<Record<string, string>> }>>,
): Promise<Specialist | null> {
  const variables = { ...dependencies.environment, ...settings[runtimeName]?.env };
  const result = connectedSpecialist(
    dependencies.remoteMcp,
    state.run.repository,
    specialist,
    variables,
  );
  if ('specialist' in result) return result.specialist;
  await dependencies.context.apply(state, {
    kind: 'attempt_exited',
    group: key.group,
    seq: key.seq,
    exit: {
      sessionId: null,
      usage: null,
      failure: { kind: 'spawn', message: result.error },
      outsideChanges: [],
    },
  });
  return null;
}

/** Checkpoints are launch-only context; their bytes remain in artifact storage. */
export async function loadCheckpoint(
  dependencies: EffectDependencies,
  prepared: Prepared,
): Promise<void> {
  prepared.checkpoint =
    (await dependencies.checkpoints?.checkpoint({
      runId: prepared.state.run.id,
      group: prepared.key.group,
      step: prepared.attempt.stepId,
      specialist: prepared.attempt.specialist,
      beforeSeq: prepared.key.seq,
    })) ?? undefined;
}

/** Queue and persist the session immediately, before a timeout can discard the exit metadata. */
export function saveSession(
  dependencies: EffectDependencies,
  state: RunState,
  key: AttemptKey,
  sessionId: string,
): void {
  void dependencies.context.serial(() =>
    dependencies.context.apply(state, {
      kind: 'attempt_session',
      group: key.group,
      seq: key.seq,
      sessionId,
    }),
  );
}
