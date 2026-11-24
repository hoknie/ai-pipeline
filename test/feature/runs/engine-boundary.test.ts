import { describe, expect, it } from 'vitest';

import { RunEngine, type EffectRunner } from '../../../src/feature/runs/services/engine.ts';
import type { RunStates } from '../../../src/feature/runs/services/states.ts';
import type { RunState } from '../../../src/feature/runs/types/index.ts';

import { run } from './helpers.ts';

/**
 * A harness that records every step the engine takes at its boundary: the save of a run (write,
 * publish, queue, notify, observe), the work of the effects and the entry of the scheduler
 * (`wakeMoments`). `tag` names the event the test applies next, so nested applies are told apart.
 */
function harness() {
  const order: string[] = [];
  const tag = { current: 'outer' };
  const states = {
    write: () => void order.push(`write:${tag.current}`),
    all: () => [] as RunState[],
  } as unknown as RunStates;
  const subject = new RunEngine({
    states,
    now: () => 1,
    wakeMarginMs: 0,
    queue: {
      runChanged: () => void order.push(`queue:${tag.current}`),
      wakeMoments: () => (order.push('wakeMoments'), []),
    } as never,
    observe: { request: () => void order.push('observe') } as never,
    notify: { runChanged: () => void order.push(`notify:${tag.current}`) },
    publish: { runSaved: () => void order.push('publish') } as never,
    network: () => ({ up: true }) as never,
  });
  return { subject, order, tag };
}

/**
 * A runner of effects that acts only on the first call, like `RunEffects` acts on the one effect
 * of an event; the performs of follow-up events only leave a mark.
 */
function runnerOnce(
  order: string[],
  act: (state: RunState, depth: () => number) => Promise<void>,
): EffectRunner {
  let depth = 0;
  return {
    async perform(state) {
      const level = depth++;
      if (level > 0) {
        order.push(`perform:nested(${level})`);
        return;
      }
      await act(state, () => depth);
    },
    busy: () => false,
    async stopAll() {},
  };
}

describe('the order of events at the engine and effects boundary', () => {
  it('runs one event as one cycle: save, then the effects, then the scheduler', async () => {
    const { subject, order, tag } = harness();
    subject.attach(runnerOnce(order, async () => void order.push('perform:outer')));
    tag.current = 'title_set';
    const state = run(1);
    await subject.apply(state, { kind: 'title_set', title: 'X' });
    expect(state.run.title).toBe('X');
    expect(order).toEqual([
      'write:title_set',
      'publish',
      'queue:title_set',
      'notify:title_set',
      'observe',
      'perform:outer',
      'wakeMoments',
    ]);
  });

  it('processes a follow-up event of an effect inside the outer perform, before the outer scheduler', async () => {
    const { subject, order, tag } = harness();
    subject.attach(
      runnerOnce(order, async (state) => {
        order.push('perform:outer-begin');
        tag.current = 'follow_up';
        await subject.apply(state, { kind: 'title_set', title: 'from-effect' });
        order.push('perform:outer-end');
      }),
    );
    const state = run(1);
    await subject.apply(state, { kind: 'title_set', title: 'outer' });
    expect(order).toEqual([
      'write:outer',
      'publish',
      'queue:outer',
      'notify:outer',
      'observe',
      'perform:outer-begin',
      'write:follow_up',
      'publish',
      'queue:follow_up',
      'notify:follow_up',
      'observe',
      'perform:nested(1)',
      'wakeMoments',
      'perform:outer-end',
      'wakeMoments',
    ]);
  });

  it('lets an effect read the state a follow-up event produced, right after it applies', async () => {
    const { subject, order, tag } = harness();
    let seen: string[] = [];
    subject.attach(
      runnerOnce(order, async (state) => {
        tag.current = 'follow_up';
        await subject.apply(state, { kind: 'title_set', title: 'from-effect' });
        seen = [state.run.title as string, String(order.includes('write:follow_up'))];
      }),
    );
    const state = run(1);
    await subject.apply(state, { kind: 'title_set', title: 'outer' });
    expect(seen).toEqual(['from-effect', 'true']);
  });

  it('holds serial work enqueued from inside the chain until the whole outer cycle has run', async () => {
    const { subject, order, tag } = harness();
    subject.attach(
      runnerOnce(order, async (state) => {
        order.push('perform:outer-begin');
        tag.current = 'queued';
        void subject.serial(async () => {
          order.push('serial:begin');
          await subject.apply(state, { kind: 'title_set', title: 'queued' });
          order.push('serial:end');
        });
        order.push('perform:outer-end');
      }),
    );
    const state = run(1);
    await subject.serial(async () => {
      await subject.apply(state, { kind: 'title_set', title: 'outer' });
    });
    // The outer call is already resolved here; the drain waits for the work it left on the queue.
    await subject.drain();
    expect(order).toEqual([
      'write:outer',
      'publish',
      'queue:outer',
      'notify:outer',
      'observe',
      'perform:outer-begin',
      'perform:outer-end',
      'wakeMoments',
      'serial:begin',
      'write:queued',
      'publish',
      'queue:queued',
      'notify:queued',
      'observe',
      'perform:nested(1)',
      'wakeMoments',
      'serial:end',
    ]);
  });

  it('interleaves serial work enqueued outside the chain between the saves of the outer cycle', async () => {
    // The engine queue holds only what was queued through `serial`: work enqueued during the
    // effects of a plain `apply` starts on the next microtask, so its save and its effects run
    // before the outer scheduler (the first `wakeMoments`), and its scheduler runs after it.
    const { subject, order, tag } = harness();
    subject.attach(
      runnerOnce(order, async (state) => {
        order.push('perform:outer-begin');
        tag.current = 'queued';
        void subject.serial(async () => {
          order.push('serial:begin');
          await subject.apply(state, { kind: 'title_set', title: 'queued' });
          order.push('serial:end');
        });
        order.push('perform:outer-end');
      }),
    );
    const state = run(1);
    await subject.apply(state, { kind: 'title_set', title: 'outer' });
    expect(order).toEqual([
      'write:outer',
      'publish',
      'queue:outer',
      'notify:outer',
      'observe',
      'perform:outer-begin',
      'perform:outer-end',
      'serial:begin',
      'write:queued',
      'publish',
      'queue:queued',
      'notify:queued',
      'observe',
      'perform:nested(1)',
      'wakeMoments',
      'wakeMoments',
      'serial:end',
    ]);
  });

  it('fails the outer apply when a follow-up event is rejected, and skips the outer scheduler', async () => {
    const { subject, order, tag } = harness();
    subject.attach(
      runnerOnce(order, async (state) => {
        order.push('perform:outer-begin');
        tag.current = 'rejected';
        await subject.apply(state, { kind: 'auto_delivery_cancelled' });
        order.push('perform:outer-end');
      }),
    );
    const state = run(1);
    state.groups[0]!.status = 'merged';
    state.run.finishedAt = 1;
    tag.current = 'outer';
    await expect(subject.apply(state, { kind: 'title_set', title: 'outer' })).rejects.toThrow();
    // The outer event is already saved; the rejected follow-up rolls nothing back.
    expect(state.run.title).toBe('outer');
    expect(order).toEqual([
      'write:outer',
      'publish',
      'queue:outer',
      'notify:outer',
      'observe',
      'perform:outer-begin',
    ]);
  });
});
