import { describe, expect, it } from 'vitest';

import { remoteAddress, remoteWebUrl } from '../../../src/feature/delivery/types/index.ts';
import { normalizeRemote } from '../../../src/feature/repos/types/index.ts';

describe('remoteWebUrl', () => {
  it.each([
    ['git@github.com:acme/app.git', 'https://github.com/acme/app/tree/aip/mx1'],
    ['https://github.com/acme/app.git', 'https://github.com/acme/app/tree/aip/mx1'],
    ['https://github.com/acme/app', 'https://github.com/acme/app/tree/aip/mx1'],
    ['ssh://git@github.com:22/acme/app.git', 'https://github.com/acme/app/tree/aip/mx1'],
    ['https://user:token@github.com/acme/app.git/', 'https://github.com/acme/app/tree/aip/mx1'],
    ['git@gitlab.com:acme/team/app.git', 'https://gitlab.com/acme/team/app/-/tree/aip/mx1'],
    ['https://gitlab.com/acme/app.git', 'https://gitlab.com/acme/app/-/tree/aip/mx1'],
    ['git@bitbucket.org:acme/app.git', 'https://bitbucket.org/acme/app/src/aip/mx1'],
    ['https://bitbucket.org/acme/app.git', 'https://bitbucket.org/acme/app/src/aip/mx1'],
    ['git@GitHub.com:acme/app.git', 'https://github.com/acme/app/tree/aip/mx1'],
  ])('%s', (address, url) => {
    expect(remoteWebUrl(address, 'aip/mx1')).toBe(url);
  });

  it.each([
    'git@git.corp.com:acme/app.git',
    '/srv/git/app.git',
    'https://github.com',
    'git@github.com:',
    '',
  ])('has no link for %j', (address) => {
    expect(remoteWebUrl(address, 'aip/mx1')).toBeNull();
  });
});

describe('remoteAddress', () => {
  it.each([
    'git@github.com:acme/app.git',
    'https://github.com/acme/app.git',
    'https://user:token@GitHub.com/acme/app/',
    'ssh://git@git.corp.com:2222/acme/team/app.git',
  ])('is the address the registry of projects matches: %s', (address) => {
    expect(remoteAddress(address)).toBe(normalizeRemote(address));
  });

  it('keeps no credentials', () => {
    expect(remoteAddress('https://user:token@github.com/acme/app.git')).toBe('github.com/acme/app');
  });

  it('keeps a local path as it is', () => {
    expect(remoteAddress('/srv/git/app.git ')).toBe('/srv/git/app.git');
  });
});
