import { describe, expect, it } from 'vitest';

import type { TaskLinkView } from '../../src/feature/queue/types/index.ts';
import { formatLinks } from '../../src/presentation/format/links.ts';
import { linkInputsOf, parseLinkFlags } from '../../src/presentation/cli/links.ts';

const view = (
  kind: TaskLinkView['kind'],
  id: string,
  number: number | null,
  repository: string | null = '/r',
): TaskLinkView => ({ kind, id, ref: 'run', number, title: id, repository });

describe('text of links', () => {
  it('shows parent, children and blockers, with the slug of another project', () => {
    const slugOf = (repository: string | null) => (repository === '/lib' ? 'lib' : undefined);
    const text = formatLinks(
      [view('parent', 'r3', 3), view('related', 'r4', 4, '/lib')],
      [view('parent', 'r8', 8), view('blocked_by', 'r10', 10)],
      slugOf,
    );
    expect(text).toBe('links: parent #3 · children #8 · blocks #10 · related lib:#4');
  });

  it('shows nothing for a task without links', () => {
    expect(formatLinks([], [], () => undefined)).toBe('');
  });
});

describe('link flags', () => {
  it('parses kind:target and turns numbers into numbers', () => {
    expect(parseLinkFlags(['related:#12', 'parent:7', 'blocked_by:abc'])).toEqual([
      { kind: 'related', target: '#12' },
      { kind: 'parent', target: 7 },
      { kind: 'blocked_by', target: 'abc' },
    ]);
    expect(() => parseLinkFlags(['oops'])).toThrow('--link expects');
  });

  it('refuses wrong combinations before calling the daemon', () => {
    expect(() => linkInputsOf({ link: ['related:1'], links: false })).toThrow('--no-links');
    expect(() => linkInputsOf({ link: ['related:1'] }, { after: true })).toThrow(
      '--link cannot be combined',
    );
    expect(linkInputsOf({})).toBeUndefined();
  });
});
