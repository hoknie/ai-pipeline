import { describe, expect, it } from 'vitest';

import { CommitStamper } from '../../../src/feature/delivery/services/commit-stamp.ts';
import { withTrailer } from '../../../src/feature/delivery/types/index.ts';
import { defaultServer } from '../../../src/feature/swarm-config/types/index.ts';
import { run } from '../runs/helpers.ts';

const TRAILER = 'aip <aip@corp.com>';

describe('the co-author trailer', () => {
  it('ends the message after an empty line', () => {
    expect(withTrailer('feat: login\n\nBody text.', TRAILER)).toBe(
      'feat: login\n\nBody text.\n\nCo-Authored-By: aip <aip@corp.com>',
    );
    expect(withTrailer('feat: login\n', TRAILER)).toBe(
      'feat: login\n\nCo-Authored-By: aip <aip@corp.com>',
    );
  });

  it('is not added twice, whatever the case of the key', () => {
    const once = withTrailer('feat: login', TRAILER);
    expect(withTrailer(once, TRAILER)).toBe(once);
    const lower = 'feat: login\n\nco-authored-by: aip <aip@corp.com>';
    expect(withTrailer(lower, TRAILER)).toBe(lower);
  });

  it('joins the trailers a message ends with, but not a subject that looks like one', () => {
    expect(withTrailer('feat: login\n\nBody.\n\nSigned-off-by: Bob <b@x.io>', TRAILER)).toBe(
      'feat: login\n\nBody.\n\nSigned-off-by: Bob <b@x.io>\nCo-Authored-By: aip <aip@corp.com>',
    );
    expect(withTrailer('fix: thing', TRAILER)).toBe(
      'fix: thing\n\nCo-Authored-By: aip <aip@corp.com>',
    );
  });

  it('adds another co-author next to the existing one', () => {
    expect(withTrailer('x\n\nCo-Authored-By: bob <bob@x.io>', TRAILER)).toBe(
      'x\n\nCo-Authored-By: bob <bob@x.io>\nCo-Authored-By: aip <aip@corp.com>',
    );
  });
});

describe('the stamp of a delivery commit', () => {
  const authors = {
    byId: (id: string) => (id === 'u1' ? { name: 'Alice', email: 'alice@corp.com' } : null),
  };
  const stamper = (server: Partial<ReturnType<typeof defaultServer>> | string) =>
    new CommitStamper({
      authors,
      config: {
        serverSettings: () =>
          typeof server === 'string' ? server : { ...defaultServer(), ...server },
      } as never,
    });

  it('is none in the local mode', () => {
    expect(stamper({ enabled: false }).stamp(run(1, { author: 'u1' }).run, 'm')).toBeNull();
    expect(stamper('broken section').stamp(run(1, { author: 'u1' }).run, 'm')).toBeNull();
  });

  it('names the author of the run and keeps the message without a trailer setting', () => {
    expect(stamper({ enabled: true }).stamp(run(1, { author: 'u1' }).run, 'feat: x')).toEqual({
      message: 'feat: x',
      identity: { author: { name: 'Alice', email: 'alice@corp.com' } },
    });
  });

  it('has no author for a run without one or with a user that is gone', () => {
    expect(stamper({ enabled: true }).stamp(run(1).run, 'm')?.identity).toEqual({ author: null });
    expect(stamper({ enabled: true }).stamp(run(1, { author: 'gone' }).run, 'm')?.identity).toEqual(
      {
        author: null,
      },
    );
  });

  it('puts server.commit_trailer at the end of the message', () => {
    const stamp = stamper({ enabled: true, commitTrailer: TRAILER }).stamp(
      run(1, { author: 'u1' }).run,
      'feat: x',
    );
    expect(stamp?.message).toBe('feat: x\n\nCo-Authored-By: aip <aip@corp.com>');
  });
});
