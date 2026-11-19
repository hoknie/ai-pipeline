import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { SignedXml } from 'xml-crypto';

export const FAKE_IDP_ENTITY = 'https://idp.corp.com/adfs/services/trust';
export const FAKE_SSO_URL = 'https://idp.corp.com/adfs/ls/';

const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  const size = body.length;
  const length =
    size < 128
      ? Buffer.from([size])
      : size < 256
        ? Buffer.from([0x81, size])
        : Buffer.from([0x82, size >> 8, size & 255]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};

const sequence = (...parts: Buffer[]) => der(0x30, ...parts);
const oid = (bytes: number[]) => der(0x06, Buffer.from(bytes));
const COMMON_NAME = oid([0x55, 0x04, 0x03]);
const SHA256_RSA = sequence(oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]), der(0x05));

/** A self-signed X.509 certificate of an RSA key, built by hand: the tests need no `openssl`. */
function certificate(publicKey: KeyObject, privateKey: KeyObject, name: string): string {
  const subject = sequence(der(0x31, sequence(COMMON_NAME, der(0x0c, Buffer.from(name)))));
  const validity = sequence(
    der(0x17, Buffer.from('200101000000Z')),
    der(0x17, Buffer.from('491231235959Z')),
  );
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1])),
    SHA256_RSA,
    subject,
    validity,
    subject,
    Buffer.from(publicKey.export({ type: 'spki', format: 'der' })),
  );
  const signature = sign('sha256', tbs, privateKey);
  const body = sequence(tbs, SHA256_RSA, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return body.toString('base64');
}

/** A key pair with its self-signed certificate: the base64 body and the PEM texts. */
export class FakeKeyPair {
  readonly privateKey: KeyObject;
  readonly certificateBody: string;
  readonly privatePem: string;
  readonly certificatePem: string;

  constructor(name: string) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.certificateBody = certificate(createPublicKey(pair.privateKey), pair.privateKey, name);
    this.privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    this.certificatePem = `-----BEGIN CERTIFICATE-----\n${this.certificateBody.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  }
}

export interface ResponseOptions {
  /** The ID of the AuthnRequest the response answers. */
  requestId: string;
  acsUrl: string;
  /** The entityID of the service; the Audience. */
  audience: string;
  nameId?: string;
  attributes?: Record<string, string | string[]>;
  /** What carries the signature; `foreign` signs the assertion with another key. Default `assertion`. */
  sign?: 'assertion' | 'response' | 'none' | 'foreign';
  /** The Audience of the assertion when it is not the service. */
  wrongAudience?: string;
  /** The Destination of the response when it is not the ACS address. */
  destination?: string;
  /** The `InResponseTo` the response claims instead of the request. */
  inResponseTo?: string;
  /** The ID of the assertion; random by default. */
  assertionId?: string;
  /** Moves the validity period of the assertion by this many milliseconds. */
  shiftMs?: number;
  now?: number;
}

const escape = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

const isoTime = (ms: number): string => new Date(ms).toISOString();

let counter = 0;

/** A SAML identity provider on paper: its metadata and signed (or not) POST responses. */
export class FakeSamlIdp {
  readonly keys = new FakeKeyPair('fake-idp');
  readonly other = new FakeKeyPair('other-idp');
  entityId = FAKE_IDP_ENTITY;
  ssoUrl = FAKE_SSO_URL;

  metadata(): string {
    return `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escape(this.entityId)}">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${this.keys.certificateBody}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${this.ssoUrl}post"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${this.ssoUrl}"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
  }

  /** The `SAMLResponse` field a browser would post to the ACS address. */
  response(options: ResponseOptions): string {
    const now = options.now ?? Date.now();
    const shift = options.shiftMs ?? 0;
    const id = options.assertionId ?? `_assertion${(counter += 1)}`;
    const attributes = Object.entries(options.attributes ?? {})
      .map(([name, value]) => {
        const values = (Array.isArray(value) ? value : [value])
          .map((item) => `<saml:AttributeValue>${escape(item)}</saml:AttributeValue>`)
          .join('');
        return `<saml:Attribute Name="${escape(name)}">${values}</saml:Attribute>`;
      })
      .join('');
    const request = options.inResponseTo ?? options.requestId;
    const until = isoTime(now + shift + 5 * 60_000);
    const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${isoTime(now + shift)}"><saml:Issuer>${escape(this.entityId)}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${escape(options.nameId ?? 'alice-persistent-id')}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${until}" Recipient="${escape(options.acsUrl)}" InResponseTo="${escape(request)}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${isoTime(now + shift - 60_000)}" NotOnOrAfter="${until}"><saml:AudienceRestriction><saml:Audience>${escape(options.wrongAudience ?? options.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${isoTime(now + shift)}" SessionIndex="_session1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attributes}</saml:AttributeStatement></saml:Assertion>`;
    const mode = options.sign ?? 'assertion';
    const signedAssertion =
      mode === 'assertion' || mode === 'foreign'
        ? this.signed(
            assertion,
            "//*[local-name(.)='Assertion']",
            mode === 'foreign' ? this.other : this.keys,
          )
        : assertion;
    const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response${(counter += 1)}" Version="2.0" IssueInstant="${isoTime(now + shift)}" Destination="${escape(options.destination ?? options.acsUrl)}" InResponseTo="${escape(request)}"><saml:Issuer>${escape(this.entityId)}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signedAssertion}</samlp:Response>`;
    const xml =
      mode === 'response'
        ? this.signed(response, "/*[local-name(.)='Response']", this.keys)
        : response;
    return Buffer.from(xml).toString('base64');
  }

  private signed(xml: string, xpath: string, keys: FakeKeyPair): string {
    const signature = new SignedXml({
      privateKey: keys.privatePem,
      publicCert: keys.certificatePem,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    signature.addReference({
      xpath,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    signature.computeSignature(xml, {
      location: { reference: `${xpath}/*[local-name(.)='Issuer']`, action: 'after' },
    });
    return signature.getSignedXml();
  }
}

/** The `RelayState` and the AuthnRequest ID the service put into the redirect to the provider. */
export function redirectParts(url: string): { relayState: string; requestXml: string } {
  const query = new URL(url).searchParams;
  const requestXml = inflateRawSync(
    Buffer.from(query.get('SAMLRequest') ?? '', 'base64'),
  ).toString();
  return { relayState: query.get('RelayState') ?? '', requestXml };
}

/** Writes the metadata of the provider and the key and certificate of the service; returns the YAML of `server.sso.saml`. */
export function writeSamlFiles(
  directory: string,
  idp: FakeSamlIdp,
  service: FakeKeyPair,
  extra = '',
): string {
  mkdirSync(directory, { recursive: true });
  const metadata = join(directory, 'idp.xml');
  const key = join(directory, 'saml.key');
  const cert = join(directory, 'saml.crt');
  writeFileSync(metadata, idp.metadata());
  writeFileSync(key, service.privatePem);
  writeFileSync(cert, service.certificatePem);
  return `    saml:
      idp_metadata: "${metadata}"
      key_file: "${key}"
      cert_file: "${cert}"
${extra}`;
}
