/**
 * A git remote address reduced to a form that is the same for `ssh` and `https` clones: no scheme,
 * no `user@`, no port, no trailing `.git` or `/`, `host:path` as `host/path`, lower case host.
 * `null` for an address that names no host and path.
 */
export function normalizeRemote(address: string): string | null {
  let text = address.trim();
  if (text === '') return null;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(text);
  if (scheme) text = text.slice(scheme[0].length);
  text = text.replace(/^[^/@]*@/, '');
  const scp = /^([^/:]+):(?!\/\/)(.*)$/.exec(text);
  if (scp && !scheme) text = `${scp[1]}/${scp[2]}`;
  const slash = text.indexOf('/');
  if (slash <= 0) return null;
  const host = text.slice(0, slash).replace(/:\d+$/, '').toLowerCase();
  const path = text
    .slice(slash + 1)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  return host === '' || path === '' ? null : `${host}/${path}`;
}
