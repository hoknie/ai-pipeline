/** An address as it is shown: scheme, host, port and path; never the userinfo, query or fragment. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return '';
  }
}
