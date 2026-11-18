import type { AcceptedEvent, AdapterDescriptor, OperationResult } from '../types/index.ts';

import type { SecretReader } from './secrets.ts';

/** The proof that the trusted verifier accepted the event; only the gate can issue it. */
export interface VerifiedToken {
  readonly brand: 'verified';
}

/** What a verifier sees: the raw bytes, the transport metadata and the secrets of one connection. */
export interface VerifyContext {
  readonly connectionId: string;
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly receivedAt: number;
  readonly secrets: SecretReader;
  /** Issues the proof for an event whose signature or token was checked on `body`. */
  accept(event: AcceptedEvent): VerifiedToken;
}

/** Checks a signature or a token on the raw bytes; registered in the composition root only. */
export interface InboundVerifierPort {
  verify(context: VerifyContext): Promise<VerifiedToken | null>;
}

export interface OutboundRequest {
  connectionId: string;
  project: string;
  action: string;
  payload: Readonly<Record<string, string>>;
  secrets: SecretReader;
  signal: AbortSignal;
}

/** An outbound call of an adapter: a safe result, a time limit, its own idempotency policy. */
export interface OutboundPort {
  perform(request: OutboundRequest): Promise<OperationResult>;
}

/** A built-in adapter: what it declares and what it does. The first version registers none. */
export interface IntegrationAdapterPort {
  descriptor: AdapterDescriptor;
  verifier?: InboundVerifierPort;
  outbound?: OutboundPort;
}
