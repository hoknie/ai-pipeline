import type { OperationResult } from './operations.ts';

export type DeliveryState = 'processing' | 'applied';

/** A claimed inbound event: the id is unique inside its connection. */
export interface Delivery {
  connectionId: string;
  externalEventId: string;
  state: DeliveryState;
  result: OperationResult | null;
  createdAt: number;
  updatedAt: number;
}

/** What a caller of the inbound gate learns; never a secret or a part of the payload. */
export type DispatchOutcome =
  | { status: 'applied'; connectionId: string; result: OperationResult }
  | { status: 'duplicate'; connectionId: string; result: OperationResult }
  | { status: 'unknown_outcome'; connectionId: string };

export interface InboundLimits {
  maxBodyBytes: number;
  deadlineMs: number;
}

export const DEFAULT_INBOUND_LIMITS: InboundLimits = {
  maxBodyBytes: 1024 * 1024,
  deadlineMs: 10_000,
};
