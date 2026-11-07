import type { RunState } from '../../runs/types/index.ts';

/** Tells the clients of the daemon that the artifacts of a run changed. */
export interface ArtifactsPublishPort {
  runChanged(state: RunState): void;
}
