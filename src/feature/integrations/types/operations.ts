/** The typed operations a verified inbound event may ask for; each runs through a service. */
export type InboundOperation =
  | { type: 'queue_task'; pipeline: string; task: string; title?: string }
  | { type: 'cancel_run'; runId: string };

export const INBOUND_OPERATION_TYPES = ['queue_task', 'cancel_run'] as const;

/** Safe metadata of a performed operation: ids and counters, never secrets. */
export type OperationResult = Record<string, string | number | boolean>;

/** What an inbound event carries once the trusted verifier accepted it. */
export interface AcceptedEvent {
  externalEventId: string;
  operation: InboundOperation;
  /** Target project (path or slug) of a global connection; a project connection accepts only its own. */
  project?: string;
}

export const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function isOperation(value: unknown): value is InboundOperation {
  if (typeof value !== 'object' || value === null) return false;
  const operation = value as Record<string, unknown>;
  if (operation.type === 'queue_task') {
    return (
      typeof operation.pipeline === 'string' &&
      operation.pipeline.length > 0 &&
      typeof operation.task === 'string' &&
      operation.task.length > 0 &&
      (operation.title === undefined || typeof operation.title === 'string')
    );
  }
  return (
    operation.type === 'cancel_run' && typeof operation.runId === 'string' && operation.runId !== ''
  );
}
