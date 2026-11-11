import type { ArtifactService } from '../../feature/artifacts/services/index.ts';
import type { ComposeServices } from '../../feature/compose/services/index.ts';
import type { DeliveryServices } from '../../feature/delivery/services/index.ts';
import type {
  ObserverHistoryService,
  ObserverService,
} from '../../feature/observers/services/index.ts';
import type { NetworkMonitor } from '../../feature/network/services/index.ts';
import type { ProcessService } from '../../feature/processes/services/index.ts';
import type { QueueServices } from '../../feature/queue/services/index.ts';
import type { ProjectService, RegistryService } from '../../feature/repos/services/index.ts';
import type { RunsServices } from '../../feature/runs/services/index.ts';
import type { StatsServices } from '../../feature/stats/services/index.ts';
import type { ConfigService } from '../../feature/swarm-config/services/index.ts';
import type {
  ConfigEditService,
  SharedConfigService,
} from '../../feature/swarm-edit/services/index.ts';
import type { TagCatalogService } from '../../feature/tags/services/index.ts';

/** The services of the features the transport of the daemon reads and calls. */
export interface DaemonServices {
  now: () => number;
  config: ConfigService;
  network: NetworkMonitor;
  registry: RegistryService;
  projects: ProjectService;
  tags: TagCatalogService;
  edits: ConfigEditService;
  shared: SharedConfigService;
  runs: RunsServices;
  processes: ProcessService;
  delivery: DeliveryServices;
  artifacts: ArtifactService;
  queue: QueueServices;
  observers: ObserverService;
  history: ObserverHistoryService;
  stats: StatsServices;
  compose: ComposeServices;
}
