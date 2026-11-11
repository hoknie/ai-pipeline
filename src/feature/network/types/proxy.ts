export type ProxyEnvironment = Record<string, string | undefined>;

function variable(environment: ProxyEnvironment, upper: string): string | null {
  const value = environment[upper] ?? environment[upper.toLowerCase()];
  return value === undefined ? null : value.trim();
}

function withScheme(proxy: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
}

function fromEnvironment(environment: ProxyEnvironment, names: string[]): string | null {
  for (const name of names) {
    const value = variable(environment, name);
    if (value !== null && value !== '') return withScheme(value);
    if (value === '') return null;
  }
  return null;
}

function targetHost(target: string): { host: string; port: number | null; secure: boolean } {
  if (/^https?:\/\//i.test(target)) {
    try {
      const url = new URL(target);
      const secure = url.protocol === 'https:';
      return {
        host: url.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
        port: Number(url.port || (secure ? 443 : 80)),
        secure,
      };
    } catch {
      return { host: target.toLowerCase(), port: null, secure: true };
    }
  }
  const at = target.lastIndexOf(':');
  if (at === -1) return { host: target.toLowerCase(), port: null, secure: true };
  return {
    host: target
      .slice(0, at)
      .replace(/^\[|\]$/g, '')
      .toLowerCase(),
    port: Number(target.slice(at + 1)),
    secure: true,
  };
}

function skipped(list: string, host: string, port: number | null): boolean {
  for (const raw of list.split(/[\s,]+/)) {
    let entry = raw.trim().toLowerCase();
    if (entry === '') continue;
    if (entry === '*') return true;
    let entryPort: number | null = null;
    const bracketed = /^\[(.+)\](?::(\d+))?$/.exec(entry);
    if (bracketed !== null) {
      entry = bracketed[1] ?? '';
      entryPort = bracketed[2] === undefined ? null : Number(bracketed[2]);
    } else if (entry.indexOf(':') === entry.lastIndexOf(':') && entry.includes(':')) {
      const at = entry.lastIndexOf(':');
      entryPort = Number(entry.slice(at + 1));
      entry = entry.slice(0, at);
    }
    if (entryPort !== null && entryPort !== port) continue;
    entry = entry.replace(/^\*?\./, '');
    if (entry === '') continue;
    if (host === entry || host.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/**
 * The proxy for a probe of `target` (a URL or `host:port`): the configured one, otherwise the one
 * of the environment (`HTTPS_PROXY` or `HTTP_PROXY`) unless `NO_PROXY` lists the target.
 */
export function probeProxy(
  target: string,
  configured: string | null,
  environment: ProxyEnvironment,
): string | null {
  if (configured !== null) return configured;
  const { host, port, secure } = targetHost(target);
  const proxy = fromEnvironment(environment, [secure ? 'HTTPS_PROXY' : 'HTTP_PROXY']);
  if (proxy === null) return null;
  const list = variable(environment, 'NO_PROXY');
  if (list !== null && skipped(list, host, port)) return null;
  return proxy;
}

/** The proxy to show in the state: the configured one, otherwise the one of the environment. */
export function shownProxy(
  configured: string | null,
  environment: ProxyEnvironment,
): string | null {
  if (configured !== null) return configured;
  return fromEnvironment(environment, ['HTTPS_PROXY', 'HTTP_PROXY']);
}
