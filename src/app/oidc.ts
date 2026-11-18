import { OidcClient } from '../feature/identity/clients/oidc/index.ts';
import type { OidcProvider } from '../feature/identity/ports/index.ts';
import type { OidcSettings } from '../feature/swarm-config/types/index.ts';

interface OidcOptions {
  settings: () => OidcSettings | null;
  environment: NodeJS.ProcessEnv;
  log: (message: string) => void;
}

/**
 * The OpenID Connect adapter of the current settings; `null` while there is no provider or its
 * client secret is missing (the reason is logged once). A changed section builds a new adapter.
 */
export function createOidcProvider({
  settings,
  environment,
  log,
}: OidcOptions): () => OidcProvider | null {
  let built: { key: string; provider: OidcProvider | null } | null = null;
  return () => {
    const oidc = settings();
    if (!oidc) return null;
    const secret = environment[oidc.clientSecretEnv];
    const key = JSON.stringify([oidc, secret === undefined || secret === '']);
    if (built?.key === key) return built.provider;
    let provider: OidcProvider | null = null;
    if (secret === undefined || secret === '') {
      log(
        `SSO sign-in is off: the environment variable ${oidc.clientSecretEnv} with the client secret is not set`,
      );
    } else {
      provider = new OidcClient({ settings: oidc, clientSecret: secret, warn: log });
    }
    built = { key, provider };
    return provider;
  };
}
