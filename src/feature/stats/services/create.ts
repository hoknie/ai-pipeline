import type { Database } from '../../../platform/sqlite/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunStates } from '../../runs/services/index.ts';
import type { RunState } from '../../runs/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import {
  StatsMetaRepository,
  StatsRecordRepository,
  StatsReportRepository,
} from '../repositories/index.ts';

import { StatsLedger } from './ledger.ts';
import { StatsReportService } from './report.ts';

export interface StatsServices {
  ledger: StatsLedger;
  report: StatsReportService;
}

export interface StatsDependencies {
  database: Database;
  config: ConfigService;
  registry: RegistryService;
  states: RunStates;
  now: () => number;
  /** Where failures of the journal go; defaults to the stderr of the daemon. */
  warn?: (message: string) => void;
  settingsCacheMs?: number;
}

const PAGE = 200;

/** The runs in memory, then every finished run of the database. */
function* allRuns(states: RunStates): Generator<RunState> {
  yield* states.all();
  for (let before: string | undefined; ;) {
    const page = states.page(PAGE, before);
    yield* page.runs;
    if (page.next === null) return;
    before = page.next;
  }
}

export function createStatsServices(dependencies: StatsDependencies): StatsServices {
  const { database, config, registry, states, now } = dependencies;
  const meta = new StatsMetaRepository(database);
  const settings = () => config.statsSettings();
  const resolve = (reference: string) => registry.resolve(reference);
  return {
    ledger: new StatsLedger({
      records: new StatsRecordRepository(database),
      meta,
      settings,
      resolve,
      runs: () => allRuns(states),
      now,
      warn:
        dependencies.warn ??
        ((message) => process.stderr.write(`aip daemon: statistics: ${message}\n`)),
      ...(dependencies.settingsCacheMs === undefined
        ? {}
        : { settingsCacheMs: dependencies.settingsCacheMs }),
    }),
    report: new StatsReportService({
      reads: new StatsReportRepository(database),
      meta,
      settings,
      resolve,
      now,
    }),
  };
}
