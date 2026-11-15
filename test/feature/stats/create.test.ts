import { describe, expect, it } from 'vitest';

import type { RegistryService } from '../../../src/feature/repos/services/index.ts';
import type { RunStates } from '../../../src/feature/runs/services/index.ts';
import { createStatsServices } from '../../../src/feature/stats/services/create.ts';
import { StatsRecordRepository } from '../../../src/feature/stats/repositories/index.ts';
import type { ConfigService } from '../../../src/feature/swarm-config/services/index.ts';
import { ConfigLoadError } from '../../../src/feature/swarm-config/types/index.ts';
import { temporaryStorage } from '../storage.ts';
import { attemptRecord } from './helpers.ts';

const NOW = new Date(2026, 5, 10, 12).getTime();

function build(load: (repository: string) => unknown) {
  const { database } = temporaryStorage();
  new StatsRecordRepository(database).insertAttempts([
    attemptRecord({ repository: '/work/app', specialist: 'coder', finishedAt: NOW - 1000 }),
  ]);
  const config = {
    statsSettings: () => ({ enabled: true, exclude: [], showCost: true }),
    load,
  } as unknown as ConfigService;
  return createStatsServices({
    database,
    config,
    registry: { resolve: async (reference: string) => reference } as unknown as RegistryService,
    states: { all: () => [], page: () => ({ runs: [], next: null }) } as unknown as RunStates,
    now: () => NOW,
  });
}

describe('names in createStatsServices', () => {
  it('builds the report without names when the configuration does not load', async () => {
    const services = build(() => {
      throw new ConfigLoadError({ kind: 'no_files', expected: ['swarm.yaml'] });
    });
    const report = await services.report.report({});
    expect(report.bySpecialist.map((row) => [row.key, row.name])).toEqual([['coder', null]]);
  });

  it('rethrows other errors of the configuration', async () => {
    const services = build(() => {
      throw new Error('disk failure');
    });
    await expect(services.report.report({})).rejects.toThrow('disk failure');
  });
});
