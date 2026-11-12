import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { launchProcess } from '../../../agents/services/index.ts';
import { answerText, namingPrompt } from '../../../agents/types/index.ts';
import { findExecutable } from '../../../../platform/process/index.ts';
import { modelIdProblem } from '../../../swarm-config/types/index.ts';
import type { RunState } from '../../types/index.ts';

import type { EffectDependencies } from './context.ts';
import { withProxy } from './proxy.ts';
import type { RunningAgents } from './running.ts';
import { workspaceOf } from './worktrees.ts';

/** Asks a cheap model for the title and the name of a run, in the background. */
export async function nameRun(
  dependencies: EffectDependencies,
  running: RunningAgents,
  state: RunState,
): Promise<void> {
  const { naming } = state.run.config;
  const { config, agents, environment, graceMs, timings, context, agentExit } = dependencies;
  if (modelIdProblem(naming.runtime, naming.model)) return;
  const settings = config.runtimeSettings(state.run.repository);
  if (typeof settings === 'string') return;
  if (!agents.isEnabled(naming.runtime, settings)) return;
  const runtime = agents.runtimeFor(naming.runtime, settings);
  if (!findExecutable(runtime.executable, environment.PATH)) return;
  const directory = join(workspaceOf(state), 'logs', state.run.id, '_naming');
  const logPath = join(directory, 'output.log');
  const task = state.split?.task ?? state.groups.map((group) => group.task).join('\n\n');
  const launch = runtime.buildOneShot({
    prompt: namingPrompt(task),
    model: naming.model,
    directory,
  });
  mkdirSync(directory, { recursive: true });
  const process = launchProcess(launch, {
    cwd: directory,
    logPath,
    parser: runtime.createParser(),
    environment: withProxy(environment, dependencies.network.proxy()),
    graceMs,
    drainMs: timings.drainMs,
  });
  running.addNaming(process, state.run.id);
  const timer = setTimeout(() => process.stop(), timings.namingTimeoutMs);
  const exit = await process.exited;
  clearTimeout(timer);
  running.removeNaming(process);
  if (process.pid !== undefined) {
    agentExit.agentGone({ pid: process.pid, run: state.run.id, group: null, seq: null });
  }
  if (context.stopping) return;
  let lines: string[] = [];
  try {
    lines = readFileSync(logPath, 'utf8').split('\n');
  } catch {
    // no output
  }
  const named = exit.code === 0 ? agents.parseNaming(answerText(runtime.transcript(lines))) : null;
  await context.serial(() =>
    context.apply(state, {
      kind: 'run_named',
      title: named?.title ?? null,
      name: named?.name ?? null,
      usage: exit.outcome.usage,
    }),
  );
}
