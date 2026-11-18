import { type JsonWebKey, constants, createPublicKey, verify } from 'node:crypto';

import { rejected } from '../../../../platform/errors/index.ts';

interface Jwk extends JsonWebKey {
  kid?: string;
  use?: string;
  alg?: string;
}

const HASH: Record<string, string> = {
  RS256: 'sha256',
  RS384: 'sha384',
  RS512: 'sha512',
  PS256: 'sha256',
  PS384: 'sha384',
  PS512: 'sha512',
  ES256: 'sha256',
  ES384: 'sha384',
  ES512: 'sha512',
};

function parseSegment(segment: string | undefined): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment ?? '', 'base64url').toString()) as Record<string, unknown>;
}

function pickKey(keys: Jwk[], kid: unknown, alg: string): Jwk | undefined {
  const wanted = alg.startsWith('ES') ? 'EC' : 'RSA';
  const candidates = keys.filter(
    (key) => key.kty === wanted && key.use !== 'enc' && (key.alg === undefined || key.alg === alg),
  );
  return typeof kid === 'string' ? candidates.find((key) => key.kid === kid) : candidates[0];
}

/** Verifies the signature of an id token with the keys of the provider (`jwks_uri`). */
export async function verifyIdTokenSignature(
  idToken: string,
  jwksUri: string,
  fetchJwks: typeof fetch,
): Promise<void> {
  const [head, body, signature] = idToken.split('.');
  const header = parseSegment(head);
  const alg = String(header.alg);
  const hash = HASH[alg];
  if (!hash || !body || !signature) {
    throw rejected(`the id token is signed with an unsupported algorithm ${alg}`);
  }
  const response = await fetchJwks(jwksUri);
  if (!response.ok)
    throw rejected(`the keys of the provider are not available (${response.status})`);
  const jwk = pickKey(((await response.json()) as { keys?: Jwk[] }).keys ?? [], header.kid, alg);
  if (!jwk) throw rejected('the id token is signed with a key the provider does not publish');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const options = alg.startsWith('PS')
    ? {
        key,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      }
    : alg.startsWith('ES')
      ? { key, dsaEncoding: 'ieee-p1363' as const }
      : { key };
  const valid = verify(
    hash,
    Buffer.from(`${head}.${body}`),
    options,
    Buffer.from(signature, 'base64url'),
  );
  if (!valid) throw rejected('the signature of the id token is wrong');
}
