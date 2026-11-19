import { textFileProblem } from '../../../../platform/files/index.ts';
import type { SamlSettings } from '../../types/settings.ts';
import {
  type ValidateContext,
  addError,
  join,
  readBoolean,
  readEntries,
  readMapping,
  readString,
  readStrings,
} from '../validate-context.ts';

const SAML_KEYS = [
  'idp_metadata',
  'entity_id',
  'key_file',
  'cert_file',
  'label',
  'claims',
  'attributes',
  'trust_email',
  'allowed_domains',
];

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** Whether the metadata setting is a URL (else it is a path of a file). */
export function isMetadataUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function checkFile(ctx: ValidateContext, value: string | null, path: string): string | null {
  if (value === null) return null;
  const problem = textFileProblem(value);
  if (problem !== null) {
    addError(ctx, path, problem);
    return null;
  }
  return value;
}

function checkMetadata(ctx: ValidateContext, value: unknown, path: string): string | null {
  const text = readString(ctx, value, path);
  if (text === null) return null;
  if (!isMetadataUrl(text)) return checkFile(ctx, text, path);
  try {
    new URL(text);
    return text;
  } catch {
    addError(ctx, path, 'must be a URL or the path of a file');
    return null;
  }
}

function checkClaims(ctx: ValidateContext, value: unknown, path: string, saml: SamlSettings) {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, path, ['email', 'name'])) {
    const text = readString(ctx, field, join(path, key));
    if (text !== null) saml.claims[key as 'email' | 'name'] = text;
  }
}

function checkAttributes(ctx: ValidateContext, value: unknown, path: string, saml: SamlSettings) {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, path, null)) {
    const text = readString(ctx, field, join(path, key));
    if (text !== null) saml.attributes[key] = text;
  }
}

function checkField(
  ctx: ValidateContext,
  saml: SamlSettings,
  key: string,
  field: unknown,
  path: string,
): void {
  if (key === 'idp_metadata') saml.idpMetadata = checkMetadata(ctx, field, path) ?? '';
  if (key === 'entity_id') saml.entityId = readString(ctx, field, path);
  if (key === 'key_file') saml.keyFile = checkFile(ctx, readString(ctx, field, path), path) ?? '';
  if (key === 'cert_file') saml.certFile = checkFile(ctx, readString(ctx, field, path), path) ?? '';
  if (key === 'label') saml.label = readString(ctx, field, path) ?? saml.label;
  if (key === 'claims') checkClaims(ctx, field, path, saml);
  if (key === 'attributes') checkAttributes(ctx, field, path, saml);
  if (key === 'trust_email') saml.trustEmail = readBoolean(ctx, field, path) ?? saml.trustEmail;
  if (key === 'allowed_domains') {
    const items = readStrings(ctx, field, path);
    items.forEach((item, index) => {
      if (!DOMAIN.test(item))
        addError(ctx, `${path}[${index}]`, 'must be a domain such as corp.com');
    });
    saml.allowedDomains = items.filter((item) => DOMAIN.test(item)).map((d) => d.toLowerCase());
  }
}

/** Checks `swarm.server.sso.saml`; `null` while there are errors. The key and the certificate are files, never inline. */
export function checkSaml(ctx: ValidateContext, value: unknown, path: string): SamlSettings | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const saml: SamlSettings = {
    idpMetadata: '',
    entityId: null,
    keyFile: '',
    certFile: '',
    label: 'SAML',
    claims: { email: null, name: null },
    attributes: {},
    trustEmail: false,
    allowedDomains: [],
  };
  const before = ctx.errors.length;
  for (const [key, field] of readEntries(ctx, mapping, path, SAML_KEYS)) {
    checkField(ctx, saml, key, field, join(path, key));
  }
  for (const required of ['idp_metadata', 'key_file', 'cert_file']) {
    if (!(required in mapping)) addError(ctx, join(path, required), 'is required');
  }
  return ctx.errors.length === before ? saml : null;
}
