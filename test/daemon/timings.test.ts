import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startDaemon, type RunningDaemon } from '../../src/app/index.ts';
import { DEFAULT_TIMINGS } from '../../src/app/index.ts';
import { KILL_GRACE_MS } from '../../src/feature/processes/services/index.ts';
import { DRAIN_MS, STOP_GRACE_MS } from '../../src/feature/agents/services/index.ts';
import { NAMING_TIMEOUT_MS, USAGE_INTERVAL_MS } from '../../src/feature/runs/services/index.ts';
import { SHORT_TIMEOUT, run, start } from './control-harness.ts';

let plain: RunningDaemon | null = null;

afterEach(async () => {
  await plain?.close();
  plain = null;
});

describe('daemon timings', () => {
  it('uses the product durations when no timings are given', async () => {
    const state = realpathSync(mkdtempSync(join(tmpdir(), 'aip-timings-')));
    plain = await startDaemon({ stateDirectory: state, entry: [process.execPath, 'unused'] });
    expect(plain.application.timings).toEqual({
      timeoutUnitMs: 1000,
      drainMs: DRAIN_MS,
      stopGraceMs: STOP_GRACE_MS,
      killGraceMs: KILL_GRACE_MS,
      wakeMarginMs: 1000,
      usageIntervalMs: USAGE_INTERVAL_MS,
      namingTimeoutMs: NAMING_TIMEOUT_MS,
      processStreamMs: 2000,
      processKillLookMs: 250,
      processCacheMs: 1000,
      statsSettingsMs: 2000,
    });
    expect(plain.application.timings).toEqual(DEFAULT_TIMINGS);
  });

  it('overrides only the durations that are given', async () => {
    const state = realpathSync(mkdtempSync(join(tmpdir(), 'aip-timings-')));
    plain = await startDaemon({
      stateDirectory: state,
      entry: [process.execPath, 'unused'],
      timings: { timeoutUnitMs: 10 },
    });
    expect(plain.application.timings).toEqual({ ...DEFAULT_TIMINGS, timeoutUnitMs: 10 });
  });

  it('counts the timeout of a step in the unit of the daemon', async () => {
    const h = await start(SHORT_TIMEOUT);
    h.script({ code: [{ hang: true }] });
    const begin = Date.now();
    const runId = await run(h);
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]).toMatchObject({ status: 'failed', reason: 'timeout' });
    // `timeout: 1s` is 50 ms for the test daemon: well below the second of a real one
    expect(Date.now() - begin).toBeLessThan(1000);
  });
});
