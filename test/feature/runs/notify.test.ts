import { describe, expect, it } from 'vitest';

import { RunEngine } from '../../../src/feature/runs/services/engine.ts';
import type { RunStates } from '../../../src/feature/runs/services/states.ts';
import type { RunState } from '../../../src/feature/runs/types/index.ts';

import { run } from './helpers.ts';

function engine(order: string[], notify: (state: RunState) => void) {
  return new RunEngine({
    states: { write: () => void order.push('write') } as unknown as RunStates,
    now: () => 1,
    wakeMarginMs: 0,
    queue: { runChanged: () => void order.push('queue') } as never,
    observe: { request: () => void order.push('observe') } as never,
    notify: { runChanged: notify },
    publish: { runSaved: () => void order.push('publish') } as never,
    network: () => ({ up: true }) as never,
  });
}

describe('the notification of a saved run', () => {
  it('is told about every save, after the state is written', () => {
    const order: string[] = [];
    const seen: string[] = [];
    const state = run(1);
    engine(order, (saved) => {
      order.push('notify');
      seen.push(saved.run.id);
    }).save(state);
    expect(seen).toEqual([state.run.id]);
    expect(order.indexOf('write')).toBeLessThan(order.indexOf('notify'));
    expect(order).toContain('observe');
  });

  it('never stops a save when the notification fails', () => {
    const order: string[] = [];
    const subject = engine(order, () => {
      throw new Error('boom');
    });
    expect(() => subject.save(run(1))).not.toThrow();
    expect(order).toContain('observe');
  });
});
