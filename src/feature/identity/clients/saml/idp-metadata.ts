import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { errorMessage, unavailable } from '../../../../platform/errors/index.ts';

/** What the service needs of the metadata of the provider. */
export interface IdpMetadata {
  entityId: string;
  /** The HTTP-Redirect address of the single sign-on service. */
  ssoUrl: string;
  /** The signing certificates in the PEM text. */
  certificates: string[];
}

const REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

const decode = (text: string): string =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : decode(value);
}

function pem(body: string): string {
  const lines = body.replace(/\s+/g, '').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** Reads the entityID, the HTTP-Redirect sign-on address and the signing certificates of a provider. */
export function parseIdpMetadata(xml: string): IdpMetadata {
  const entity = /<(?:[\w-]+:)?EntityDescriptor\b[^>]*>/.exec(xml);
  const entityId = entity ? attribute(entity[0], 'entityID') : null;
  const descriptor = /<(?:[\w-]+:)?IDPSSODescriptor\b[\s\S]*?<\/(?:[\w-]+:)?IDPSSODescriptor>/.exec(
    xml,
  );
  if (!entityId || !descriptor) throw new Error('the metadata describe no identity provider');
  const services = descriptor[0].match(/<(?:[\w-]+:)?SingleSignOnService\b[^>]*>/g) ?? [];
  const redirect = services.find((tag) => attribute(tag, 'Binding') === REDIRECT);
  const ssoUrl = redirect ? attribute(redirect, 'Location') : null;
  if (!ssoUrl) throw new Error('the metadata have no HTTP-Redirect SingleSignOnService');
  const certificates: string[] = [];
  const keys = descriptor[0].matchAll(
    /<(?:[\w-]+:)?KeyDescriptor\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?KeyDescriptor>/g,
  );
  for (const [, tag, body] of keys) {
    if (attribute(` ${tag ?? ''}`, 'use') === 'encryption') continue;
    const cert = /<(?:[\w-]+:)?X509Certificate>([\s\S]*?)<\/(?:[\w-]+:)?X509Certificate>/.exec(
      body ?? '',
    );
    if (cert?.[1]) certificates.push(pem(cert[1]));
  }
  if (certificates.length === 0) throw new Error('the metadata have no signing certificate');
  return { entityId, ssoUrl, certificates };
}

/** How long a loaded copy of the metadata is used before the next download. */
export const METADATA_REFRESH_MS = 24 * 60 * 60_000;

export interface IdpMetadataSourceOptions {
  /** An http(s) URL or the path of a file. */
  location: string;
  /** Where the last good download is kept; the source starts from it when the provider is down. */
  copyPath: string;
  now: () => number;
  fetch?: typeof fetch;
  warn: (message: string) => void;
}

/** The metadata of the provider: downloaded at the start and once a day, the last good copy kept on disk. */
export class IdpMetadataSource {
  private readonly options: IdpMetadataSourceOptions;
  private current: IdpMetadata | null = null;
  private loadedAt = 0;
  private pending: Promise<void> | null = null;
  private state: 'unknown' | 'ready' | 'unavailable' = 'unknown';

  constructor(options: IdpMetadataSourceOptions) {
    this.options = options;
  }

  status(): 'unknown' | 'ready' | 'unavailable' {
    return this.state;
  }

  /** The metadata; loads them when there are none, refreshes them in the background once a day. */
  async get(): Promise<IdpMetadata> {
    if (this.current && this.options.now() - this.loadedAt >= METADATA_REFRESH_MS) {
      void this.load();
    }
    if (!this.current) await this.load();
    if (!this.current) {
      throw unavailable(
        'identity.saml_unavailable',
        'the metadata of the SAML provider are not available',
      );
    }
    return this.current;
  }

  /** Loads the metadata now; the outcome is in `status()`. */
  load(): Promise<void> {
    this.pending ??= this.fetchAndParse().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchAndParse(): Promise<void> {
    const { location, copyPath } = this.options;
    try {
      const isUrl = /^https?:\/\//i.test(location);
      const xml = isUrl ? await this.download(location) : readFileSync(location, 'utf8');
      this.current = parseIdpMetadata(xml);
      if (isUrl) this.saveCopy(xml);
      this.loadedAt = this.options.now();
      this.state = 'ready';
    } catch (error) {
      this.options.warn(
        `SAML provider metadata ${location} are not available: ${errorMessage(error)}`,
      );
      this.loadedAt = this.options.now();
      if (this.current) return;
      try {
        this.current = parseIdpMetadata(readFileSync(copyPath, 'utf8'));
        this.state = 'ready';
        this.options.warn('SAML sign-in uses the last good copy of the provider metadata');
      } catch {
        this.state = 'unavailable';
      }
    }
  }

  private async download(url: string): Promise<string> {
    const response = await (this.options.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  private saveCopy(xml: string): void {
    try {
      mkdirSync(dirname(this.options.copyPath), { recursive: true, mode: 0o700 });
      writeFileSync(this.options.copyPath, xml, { mode: 0o600 });
    } catch (error) {
      this.options.warn(`cannot keep the copy of the provider metadata: ${errorMessage(error)}`);
    }
  }
}
