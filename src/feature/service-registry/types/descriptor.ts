import type { AdapterDescriptor } from '../../integrations/types/index.ts';

export const SERVICE_REGISTRY_KIND = 'service-registry';
export const URL_LIMIT = 2048;

/**
 * The address of a registry: `http://` or `https://`, a host with an optional port and nothing
 * after it but a slash: no credentials, no path, no query, no fragment.
 */
const URL_PATTERN =
  'https?://[A-Za-z0-9.\\-]+(?::[0-9]{1,5})?/?|https?://\\[[0-9A-Fa-f:.]+\\](?::[0-9]{1,5})?/?';

/** What the catalog of integrations knows about the kind: the address and the token. */
export const serviceRegistryDescriptor: AdapterDescriptor = {
  kind: SERVICE_REGISTRY_KIND,
  title: 'Service registry',
  params: [{ name: 'url', required: true, maxLength: URL_LIMIT, pattern: URL_PATTERN }],
  secrets: [{ slot: 'token', required: true }],
  directions: ['outbound'],
  operations: [],
};

/**
 * The root of a registry from the `url` parameter without the trailing slash, or null when the
 * address is not acceptable. Pure: no network is involved.
 */
export function registryBase(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > URL_LIMIT) return null;
  if (!new RegExp(`^(?:${URL_PATTERN})$`, 'u').test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return null;
  }
  return `${parsed.protocol}//${parsed.host}`;
}
