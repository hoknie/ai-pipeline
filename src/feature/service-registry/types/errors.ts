/** The codes a failed call of a registry ends with; nothing else leaves the client. */
export const REGISTRY_CODES = [
  'unreachable',
  'timeout',
  'unauthorized',
  'protocol',
  'too_large',
] as const;

export type RegistryCode = (typeof REGISTRY_CODES)[number];

/** The codes a bridge answers with when the daemon refuses to forward. */
export const BRIDGE_CODES = [
  ...REGISTRY_CODES,
  'server_not_allowed',
  'attempt_finished',
  'connection_disabled',
  'secret_unavailable',
] as const;

export type BridgeCode = (typeof BRIDGE_CODES)[number];

/** A failed call: a static code, never a response text, a header or a token. */
export class RegistryFailure extends Error {
  readonly code: BridgeCode;

  constructor(code: BridgeCode) {
    super(code);
    this.name = 'RegistryFailure';
    this.code = code;
  }
}
