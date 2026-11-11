import { describe, expect, it } from 'vitest';

import { probeProxy, shownProxy } from '../../../src/feature/network/types/index.ts';

const P = 'http://10.0.0.5:3128';

describe('probeProxy', () => {
  it('prefers the configured proxy to the environment and NO_PROXY', () => {
    expect(
      probeProxy('https://a.test', 'http://1.1.1.1:1', { HTTPS_PROXY: P, NO_PROXY: '*' }),
    ).toBe('http://1.1.1.1:1');
  });

  it('takes HTTPS_PROXY for https targets and host:port, HTTP_PROXY for http targets', () => {
    const env = { HTTPS_PROXY: P, HTTP_PROXY: 'http://10.0.0.6:80' };
    expect(probeProxy('https://a.test', null, env)).toBe(P);
    expect(probeProxy('a.test:443', null, env)).toBe(P);
    expect(probeProxy('http://a.test', null, env)).toBe('http://10.0.0.6:80');
  });

  it('reads lower-case variables, adds http:// and treats an empty value as no proxy', () => {
    expect(probeProxy('https://a.test', null, { https_proxy: '10.0.0.5:3128' })).toBe(P);
    expect(probeProxy('https://a.test', null, { HTTPS_PROXY: '' })).toBeNull();
    expect(probeProxy('https://a.test', null, {})).toBeNull();
  });

  it('honours NO_PROXY only for the proxy of the environment', () => {
    const env = (list: string) => ({ HTTPS_PROXY: P, NO_PROXY: list });
    expect(probeProxy('https://a.test', null, env('*'))).toBeNull();
    expect(probeProxy('https://api.a.test', null, env('a.test'))).toBeNull();
    expect(probeProxy('https://api.a.test', null, env('.a.test'))).toBeNull();
    expect(probeProxy('https://A.test', null, env('a.TEST, other'))).toBeNull();
    expect(probeProxy('https://xa.test', null, env('a.test'))).toBe(P);
    expect(probeProxy('https://a.test', null, { HTTPS_PROXY: P, no_proxy: 'a.test' })).toBeNull();
  });

  it('matches host:port entries by port and IPv6 without brackets', () => {
    const env = (list: string) => ({ HTTPS_PROXY: P, NO_PROXY: list });
    expect(probeProxy('https://a.test', null, env('a.test:443'))).toBeNull();
    expect(probeProxy('https://a.test', null, env('a.test:8443'))).toBe(P);
    expect(probeProxy('[::1]:443', null, env('::1'))).toBeNull();
    expect(probeProxy('[::1]:443', null, env('[::1]:443'))).toBeNull();
    expect(probeProxy('[::1]:443', null, env('[::1]:80'))).toBe(P);
  });
});

describe('shownProxy', () => {
  it('shows the configured proxy, else the one of the environment, else null', () => {
    expect(shownProxy('http://1.1.1.1:1', { HTTPS_PROXY: P })).toBe('http://1.1.1.1:1');
    expect(shownProxy(null, { HTTP_PROXY: P })).toBe(P);
    expect(shownProxy(null, { https_proxy: '10.0.0.5:3128' })).toBe(P);
    expect(shownProxy(null, {})).toBeNull();
  });
});
