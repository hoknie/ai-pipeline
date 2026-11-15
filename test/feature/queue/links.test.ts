import { describe, expect, it } from 'vitest';

import {
  type TaskLink,
  checkLinkKind,
  checkLinks,
  checkParentCycle,
  linkViews,
  normalizeLinks,
  resolveLinks,
} from '../../../src/feature/queue/types/index.ts';

const link = (source: string, kind: TaskLink['kind'], target: string): TaskLink => ({
  source,
  kind,
  target,
});

describe('checking links', () => {
  it('rejects a link to itself', () => {
    expect(() => checkLinks('q1', [link('q1', 'related', 'q1')], false)).toThrow(
      'a task cannot link to itself',
    );
    expect(() => checkLinks('q1', [], false)).not.toThrow();
  });

  it('rejects a second parent', () => {
    expect(() =>
      checkLinks('q3', [link('q3', 'parent', 'r1'), link('q3', 'parent', 'r2')], false),
    ).toThrow('a task has only one parent');
    expect(() => checkLinks('q3', [link('q3', 'parent', 'r1')], false)).not.toThrow();
  });

  it('rejects a new blocked_by of a started run', () => {
    expect(() => checkLinks('r1', [link('r1', 'blocked_by', 'q3')], true)).toThrow(
      'a started task cannot be blocked',
    );
    // a run may still take a parent and the other kinds
    expect(() => checkLinks('r1', [link('r1', 'parent', 'r0')], true)).not.toThrow();
    expect(() => checkLinks('q1', [link('q1', 'blocked_by', 'q3')], false)).not.toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() => checkLinkKind('follows')).toThrow('unknown link kind `follows`');
    expect(checkLinkKind('duplicates')).toBe('duplicates');
  });
});

describe('collapsing repeated links', () => {
  it('keeps the first of equal links', () => {
    const links = [
      link('q2', 'related', 'q1'),
      link('q2', 'related', 'q1'),
      link('q2', 'blocked_by', 'q1'),
      link('q2', 'blocked_by', 'q1'),
    ];
    expect(normalizeLinks(links)).toEqual([
      link('q2', 'related', 'q1'),
      link('q2', 'blocked_by', 'q1'),
    ]);
  });

  it('takes a related link of the other side for the same link', () => {
    expect(normalizeLinks([link('q1', 'related', 'q2'), link('q2', 'related', 'q1')])).toEqual([
      link('q1', 'related', 'q2'),
    ]);
    // every other kind keeps its direction
    expect(
      normalizeLinks([link('q1', 'duplicates', 'q2'), link('q2', 'duplicates', 'q1')]),
    ).toEqual([link('q1', 'duplicates', 'q2'), link('q2', 'duplicates', 'q1')]);
  });
});

describe('views of links', () => {
  const describe = (other: string) => ({
    ref: other.startsWith('r') ? ('run' as const) : ('item' as const),
    number: 7,
    title: `задача ${other}`,
    repository: '/repo',
  });

  it('shows the other side of blocked_by and parent as linkedBy', () => {
    // q2 waits for q1, q3 has the parent q1
    const views = linkViews(
      {
        out: [],
        into: [link('q2', 'blocked_by', 'q1'), link('q3', 'parent', 'q1')],
      },
      (other) => describe(other),
    );
    expect(views.links).toEqual([]);
    expect(views.linkedBy).toEqual([
      { kind: 'blocked_by', id: 'q2', ...describe('q2') },
      { kind: 'parent', id: 'q3', ...describe('q3') },
    ]);
  });

  it('shows a related link on both sides as links and never as linkedBy', () => {
    // the index keeps both rows of a related link, `viewsOf` collapses them first
    const both = normalizeLinks([link('r1', 'related', 'q4'), link('q4', 'related', 'r1')]);
    const ofFirst = linkViews(
      {
        out: both.filter((entry) => entry.source === 'r1'),
        into: both.filter((entry) => entry.target === 'r1'),
      },
      (other) => describe(other),
    );
    const ofSecond = linkViews(
      {
        out: both.filter((entry) => entry.source === 'q4'),
        into: both.filter((entry) => entry.target === 'q4'),
      },
      (other) => describe(other),
    );
    expect(ofFirst.links).toEqual([{ kind: 'related', id: 'q4', ...describe('q4') }]);
    expect(ofSecond.links).toEqual([{ kind: 'related', id: 'r1', ...describe('r1') }]);
    expect(ofFirst.linkedBy).toEqual([]);
    expect(ofSecond.linkedBy).toEqual([]);
  });
});

describe('the links of a new task', () => {
  it('puts blocked_by first, then the parent, then the rest', () => {
    const plan = resolveLinks(
      (ref) => `id:${String(ref)}`,
      [
        { kind: 'related', target: 'r5' },
        { kind: 'parent', target: 'r1' },
        { kind: 'blocked_by', target: 'q2' },
        { kind: 'blocked_by', target: 'q1' },
        { kind: 'duplicates', target: 'r0' },
      ],
    );
    expect(plan).toEqual({
      after: ['id:q2', 'id:q1'],
      parent: 'id:r1',
      others: [
        { kind: 'related', target: 'id:r5' },
        { kind: 'duplicates', target: 'id:r0' },
      ],
    });
  });

  it('collapses repeated targets and keeps one parent', () => {
    const plan = resolveLinks(
      (ref) => `id:${String(ref)}`,
      [
        { kind: 'blocked_by', target: 'q1' },
        { kind: 'blocked_by', target: 'q1' },
        { kind: 'parent', target: 'r1' },
        { kind: 'parent', target: 'r1' },
      ],
    );
    expect(plan).toEqual({ after: ['id:q1'], parent: 'id:r1', others: [] });
    expect(() =>
      resolveLinks(
        (ref) => `id:${String(ref)}`,
        [
          { kind: 'parent', target: 'r1' },
          { kind: 'parent', target: 'r2' },
        ],
      ),
    ).toThrow('a task has only one parent');
    expect(() =>
      resolveLinks((ref) => `id:${String(ref)}`, [{ kind: 'follows', target: 'r1' }]),
    ).toThrow('unknown link kind `follows`');
  });

  it('resolves numbers of tasks as well as identifiers', () => {
    const plan = resolveLinks(
      (ref) => `task:${String(ref)}`,
      [
        { kind: 'blocked_by', target: 5 },
        { kind: 'parent', target: '#7' },
        { kind: 'related', target: 'r1' },
      ],
    );
    expect(plan).toEqual({
      after: ['task:5'],
      parent: 'task:#7',
      others: [{ kind: 'related', target: 'task:r1' }],
    });
  });
});

describe('a parent cycle', () => {
  it('ends on a cycle with its path', () => {
    const parents = new Map([
      ['q2', 'q1'],
      ['q1', 'q3'],
    ]);
    expect(() => checkParentCycle((id) => parents.get(id), 'q1', 'q2')).toThrow(
      'parent cycle: q1 → q2 → q1',
    );
  });

  it('lets a chain of parents that leads nowhere pass', () => {
    const parents = new Map([
      ['q2', 'r0'],
      ['r0', 'r9'],
    ]);
    expect(() => checkParentCycle((id) => parents.get(id), 'q1', 'q2')).not.toThrow();
    expect(() => checkParentCycle(() => undefined, 'q1', 'q9')).not.toThrow();
  });

  it('ends on a cycle that is already in the stored data', () => {
    const parents = new Map([
      ['q2', 'q1'],
      ['q1', 'q2'],
    ]);
    expect(() => checkParentCycle((id) => parents.get(id), 'q1', 'q2')).toThrow(
      'parent cycle: q1 → q2 → q1',
    );
  });
});
