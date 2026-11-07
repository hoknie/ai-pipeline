import type { ArtifactRepository } from '../feature/artifacts/repositories/index.ts';
import type { PatchRepository } from '../feature/delivery/repositories/index.ts';
import type { ObserverRepository } from '../feature/observers/repositories/index.ts';
import type { QueueRepository } from '../feature/queue/repositories/index.ts';
import type { KnownRepositories } from '../feature/repos/repositories/index.ts';
import type { FinishedRunRepository, RunRepository } from '../feature/runs/repositories/index.ts';
import type { TagRepository } from '../feature/tags/repositories/index.ts';

/** The repositories of the features the daemon reads and writes through, until its services split. */
export interface DaemonRepositories {
  runs: RunRepository;
  finished: FinishedRunRepository;
  queues: QueueRepository;
  known: KnownRepositories;
  tags: TagRepository;
  patches: PatchRepository;
  artifacts: ArtifactRepository;
  observers: ObserverRepository;
}
