/** The path of the page of a branch at each known host. */
const BRANCH_PAGES: Record<string, (branch: string) => string> = {
  'github.com': (branch) => `/tree/${branch}`,
  'gitlab.com': (branch) => `/-/tree/${branch}`,
  'bitbucket.org': (branch) => `/src/${branch}`,
};

/** `host` and `owner/name` of an `ssh` or `https` remote address, or `null`. */
function hostAndPath(address: string): { host: string; path: string } | null {
  let text = address.trim();
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
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '');
  return path === '' ? null : { host, path };
}

/**
 * The address of a remote repository the same for `ssh` and `https` clones, without credentials:
 * `host/owner/name` with a lower case host. An address that is no URL (a local path) stays as it is.
 */
export function remoteAddress(address: string): string {
  const parts = hostAndPath(address);
  return parts === null ? address.trim() : `${parts.host}/${parts.path}`;
}

/**
 * The address of a branch in the web interface of GitHub, GitLab or Bitbucket, from the address of
 * the remote (`ssh` or `https`); `null` for another host or an address with no host and path.
 */
export function remoteWebUrl(address: string, branch: string): string | null {
  const parts = hostAndPath(address);
  const page = parts === null ? undefined : BRANCH_PAGES[parts.host];
  return parts === null || !page ? null : `https://${parts.host}/${parts.path}${page(branch)}`;
}
