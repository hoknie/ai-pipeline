import { describe, expect, it } from 'vitest';

import { bulkTargets } from '../src/features/queue/overview/bulk.ts';
import { queueItem, queueOf } from './fixtures.ts';

const registry = [
  { path: '/work/app', enabled: true },
  { path: '/work/lib', enabled: true },
  { path: '/work/off', enabled: false },
];
const paths = (queues: { repository: string }[]) => queues.map((queue) => queue.repository);

describe('bulkTargets', () => {
  it('starts stopped queues with a waiting task that is not postponed', () => {
    const queues = [
      queueOf({ repository: '/work/app', items: [queueItem('a', 'x', 1)] }),
      queueOf({ repository: '/work/lib' }),
      queueOf({
        repository: '/work/web',
        items: [queueItem('b', 'y', 1, { postponed: true })],
      }),
    ];
    const known = [...registry, { path: '/work/web', enabled: true }];
    expect(paths(bulkTargets(queues, known, 'start'))).toEqual(['/work/app']);
  });

  it('does not start a running queue, a queue waiting for a limit or a disabled project', () => {
    const queues = [
      queueOf({ repository: '/work/app', status: 'running', items: [queueItem('a', 'x', 1)] }),
      queueOf({
        repository: '/work/lib',
        items: [queueItem('b', 'y', 1)],
        stop: {
          kind: 'limit',
          runtime: 'claude',
          run: 'r',
          group: 'g',
          resetsAt: 1,
          autoResume: true,
        } as never,
      }),
      queueOf({ repository: '/work/off', items: [queueItem('c', 'z', 1)] }),
    ];
    expect(bulkTargets(queues, registry, 'start')).toEqual([]);
  });

  it('pauses a running queue and one that waits for a limit to reset', () => {
    const queues = [
      queueOf({ repository: '/work/app', status: 'running' }),
      queueOf({
        repository: '/work/lib',
        stop: {
          kind: 'limit',
          runtime: 'claude',
          run: 'r',
          group: 'g',
          resetsAt: 1,
          autoResume: true,
        } as never,
      }),
      queueOf({ repository: '/work/off', status: 'running' }),
    ];
    expect(paths(bulkTargets(queues, registry, 'pause'))).toEqual(['/work/app', '/work/lib']);
    expect(bulkTargets([queueOf({ repository: '/work/app' })], registry, 'pause')).toEqual([]);
  });
});
