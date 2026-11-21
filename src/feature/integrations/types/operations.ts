/** The typed operations a verified inbound event may ask for; each runs through a service. */
export type InboundOperation =
  | { type: 'queue_task'; pipeline: string; task: string; title?: string; skipDuplicate?: boolean }
  | { type: 'cancel_run'; runId: string };

export const INBOUND_OPERATION_TYPES = ['queue_task', 'cancel_run'] as const;

/** Safe metadata of a performed operation: ids and counters, never secrets. */
export type OperationResult = Record<string, string | number | boolean>;

/** Short labels of an event for the log of the daemon: what it was and what it was about. */
export interface EventMeta {
  type: string;
  path: string;
}

/** What an inbound event carries once the trusted verifier accepted it. */
export interface AcceptedEvent {
  externalEventId: string;
  operation: InboundOperation;
  /** Target project (path or slug) of a global connection; a project connection accepts only its own. */
  project?: string;
  meta?: EventMeta;
}

/** An event whose signature was checked but that asks for nothing; `ignored` is a static reason. */
export interface IgnoredEvent {
  externalEventId: string;
  ignored: string;
  meta?: EventMeta;
}

export const META_LIMIT = 128;

/** The labels cut to a short length and stripped of control characters. */
export function trimMeta(meta: EventMeta | undefined): EventMeta | undefined {
  if (meta === undefined) return undefined;
  const clean = (value: unknown): string =>
    String(value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .slice(0, META_LIMIT);
  return { type: clean(meta.type), path: clean(meta.path) };
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
      (operation.title === undefined || typeof operation.title === 'string') &&
      (operation.skipDuplicate === undefined || typeof operation.skipDuplicate === 'boolean')
    );
  }
  return (
    operation.type === 'cancel_run' && typeof operation.runId === 'string' && operation.runId !== ''
  );
}
