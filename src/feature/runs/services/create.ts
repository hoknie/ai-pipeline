import { join } from 'node:path';

import type { Database } from '../../../platform/sqlite/index.ts';
import type { AgentsService } from '../../agents/services/index.ts';
import type { NetworkMonitor } from '../../network/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import { defaultQueue } from '../../swarm-config/types/index.ts';
import type {
  AgentExitPort,
  DiffPort,
  ObservePort,
  QueueAdvancePort,
  RegistrySkillsPort,
  RemoteMcpPort,
  RegistryProjectPort,
  RunAttachmentsPort,
  RunNotifyPort,
  RunCommitsPort,
  RunPushPort,
  RunsPublishPort,
} from '../ports/index.ts';
import {
  AttemptHistoryRepository,
  FinishedRunRepository,
  LessonStorage,
  LessonsRepository,
  ProbeFiles,
  RunRepository,
} from '../repositories/index.ts';

import { RunArchive } from './archive.ts';
import { probeCheck } from './probes/check.ts';
import { RunProbes } from './probes/service.ts';
import type { EffectTimings } from './effects/context.ts';
import { RunEffects } from './effects/effects.ts';
import { RunCleanup } from './cleanup/index.ts';
import { RunEngine } from './engine.ts';
import { RunLessons } from './lessons/index.ts';
import { RunReads } from './reads.ts';
import { RunRequests } from './requests.ts';
import { RunStates } from './states.ts';
import { RunAttemptHistoryService } from './attempt-history.ts';

export interface RunsDependencies {
  database: Database;
  /** The state directory: the lessons files live under `lessons/` in it. */
  stateDirectory: string;
  now: () => number;
  agents: AgentsService;
  config: ConfigService;
  network: NetworkMonitor;
  registry: RegistryService;
  socket: string;
  environment: NodeJS.ProcessEnv;
  entry: string[];
  graceMs: number | undefined;
  timings: EffectTimings & { wakeMarginMs: number };
  queue: QueueAdvancePort;
  observe: ObservePort;
  /** Hears about every saved run; a test that does not care may leave it out. */
  notify?: RunNotifyPort;
  publish: RunsPublishPort;
  diff: DiffPort;
  agentExit: AgentExitPort;
  attachments: RunAttachmentsPort;
  remoteMcp: RemoteMcpPort;
  registrySkills: RegistrySkillsPort;
  registryProject: RegistryProjectPort;
  commits: RunCommitsPort;
  push: RunPushPort;
}

export interface RunsServices {
  attemptHistory: RunAttemptHistoryService;
  lessons: RunLessons;
  states: RunStates;
  engine: RunEngine;
  effects: RunEffects;
  requests: RunRequests;
  probes: RunProbes;
  reads: RunReads;
  cleanup: RunCleanup;
}

export function createRunsServices(dependencies: RunsDependencies): RunsServices {
  const { database, now, timings } = dependencies;
  const runs = new RunRepository(database);
  const states = new RunStates({
    database,
    runs,
    finished: new FinishedRunRepository(database, runs),
    now,
  });
  const engine = new RunEngine({
    states,
    now,
    wakeMarginMs: timings.wakeMarginMs,
    queue: dependencies.queue,
    observe: dependencies.observe,
    notify: dependencies.notify ?? { runChanged: () => undefined },
    publish: dependencies.publish,
    network: () => dependencies.network.snapshot(),
    limit: () => {
      const queue = dependencies.config.queueSettings();
      // A wrong `queue` section: the project mode with the default limit and no pools.
      const settings = typeof queue === 'string' ? defaultQueue() : queue;
      return {
        kind: settings.scope === 'global' ? 'machine' : 'repository',
        max: settings.max,
        pools: settings.pools,
        defaultPool: settings.defaultPool,
      };
    },
  });
  const lessons = new RunLessons({
    runs: new LessonsRepository(database),
    storage: new LessonStorage(join(dependencies.stateDirectory, 'lessons')),
    now,
  });
  const effects = new RunEffects({ ...dependencies, lessons, context: engine });
  engine.attach(effects);
  const { registry, config, agents } = dependencies;
  const requests = new RunRequests({ states, engine, effects, registry, config, now });
  const probes = new RunProbes({
    states,
    launcher: requests,
    store: new ProbeFiles(join(dependencies.stateDirectory, 'probes')),
    config,
    check: probeCheck,
    engine,
    now,
  });
  engine.attachProbes(probes);
  return {
    attemptHistory: new RunAttemptHistoryService(new AttemptHistoryRepository(database)),
    lessons,
    states,
    engine,
    effects,
    requests,
    probes,
    reads: new RunReads({ states, effects, agents }),
    cleanup: new RunCleanup({ engine, diff: dependencies.diff }),
  };
}

/** The stored runs without the engine: what the maintenance of the state directory reads. */
export function createRunArchive(database: Database): RunArchive {
  const runs = new RunRepository(database);
  return new RunArchive(runs, new FinishedRunRepository(database, runs));
}
