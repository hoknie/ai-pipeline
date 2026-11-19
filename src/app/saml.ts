import { join } from 'node:path';

import { IdpMetadataSource, SamlClient } from '../feature/identity/clients/saml/index.ts';
import type { SamlAssertionStore, SamlProvider } from '../feature/identity/ports/index.ts';
import { type SamlSettings, samlEntityId } from '../feature/swarm-config/types/index.ts';
import { errorMessage } from '../platform/errors/index.ts';
import { readTextFile } from '../platform/files/index.ts';

interface SamlOptions {
  settings: () => { saml: SamlSettings | null; publicUrl: string | null };
  /** Where the accepted assertions are remembered. */
  assertions: SamlAssertionStore;
  stateDirectory: string;
  now: () => number;
  log: (message: string) => void;
}

/**
 * The SAML adapter of the current settings; `null` while there is no provider, no `public_url` or
 * the key or the certificate cannot be read (the reason is logged once). A changed section builds a
 * new adapter, which reads the files and the metadata again.
 */
export function createSamlProvider({
  settings,
  assertions,
  stateDirectory,
  now,
  log,
}: SamlOptions): () => SamlProvider | null {
  let built: { key: string; provider: SamlProvider | null } | null = null;
  return () => {
    const { saml, publicUrl } = settings();
    if (!saml || !publicUrl) return null;
    const key = JSON.stringify([saml, publicUrl]);
    if (built?.key === key) return built.provider;
    let provider: SamlProvider | null = null;
    try {
      provider = new SamlClient({
        entityId: samlEntityId(saml, publicUrl),
        acsUrl: `${publicUrl}/auth/saml/acs`,
        privateKey: readTextFile(saml.keyFile),
        certificate: readTextFile(saml.certFile),
        metadata: new IdpMetadataSource({
          location: saml.idpMetadata,
          copyPath: join(stateDirectory, 'saml', 'idp-metadata.xml'),
          now,
          warn: log,
        }),
        assertions,
      });
    } catch (error) {
      log(`SAML sign-in is off: ${errorMessage(error)}`);
    }
    built = { key, provider };
    return provider;
  };
}
