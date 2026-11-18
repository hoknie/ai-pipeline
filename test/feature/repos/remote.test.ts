import { describe, expect, it } from 'vitest';

import { normalizeRemote } from '../../../src/feature/repos/types/index.ts';

describe('normalizeRemote', () => {
  it('gives one form to ssh and https addresses of a repository', () => {
    const forms = [
      'git@github.com:acme/app.git',
      'https://github.com/acme/app.git',
      'https://user@github.com/acme/app',
      'ssh://git@github.com/acme/app.git',
      'ssh://git@github.com:22/acme/app/',
      'https://GitHub.com/acme/app',
    ].map(normalizeRemote);
    expect(new Set(forms)).toEqual(new Set(['github.com/acme/app']));
  });

  it('keeps nested paths and refuses an address without a path', () => {
    expect(normalizeRemote('git@gitlab.example.com:group/sub/app.git')).toBe(
      'gitlab.example.com/group/sub/app',
    );
    expect(normalizeRemote('')).toBeNull();
    expect(normalizeRemote('https://github.com')).toBeNull();
    expect(normalizeRemote('/local/path')).toBeNull();
  });
});
