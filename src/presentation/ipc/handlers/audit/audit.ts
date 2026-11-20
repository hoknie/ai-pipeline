import { AppError } from '../../../../platform/errors/index.ts';
import {
  AUDIT_SYSTEM,
  clipText,
  type AuditOutcome,
} from '../../../../feature/audit/types/index.ts';
import { authorOf } from '../../../../feature/identity/types/index.ts';
import type { Request } from '../../contract/index.ts';
import type { AuditInfo, AuditRow } from './audit-helpers.ts';
import { auditActions } from './audit-table.ts';
import { ACCESS_DENIED } from '../access/guard.ts';
import { actionOf } from '../access/method-actions.ts';
import type { IpcContext } from '../types.ts';

type Params = Record<string, unknown>;

/** The path of the project a call is about: by `repository` or `path` (a path or a slug), or by its run. */
function projectOf(params: Params, context: IpcContext): string | null {
  const { registry, runs } = context.services;
  const reference = params.repository ?? params.path;
  if (typeof reference === 'string') {
    try {
      return registry.pathOf(reference);
    } catch {
      return reference;
    }
  }
  if (typeof params.runId === 'string') {
    return runs.states.lookup(params.runId)?.run.repository ?? null;
  }
  return null;
}

/** What the row says about the call; a row that cannot be read for the journal still gives an entry. */
function describe(row: AuditRow, params: Params, result: unknown, context: IpcContext): AuditInfo {
  try {
    return row.info?.(params, result, context) ?? {};
  } catch {
    return {};
  }
}

/** A refusal of the rights is `denied`; every other error is `failed`. */
function outcomeOf(error: unknown): AuditOutcome {
  return error instanceof AppError && error.kind === 'forbidden' ? 'denied' : 'failed';
}

function record(
  request: Request,
  row: AuditRow,
  context: IpcContext,
  answer: { ok: true; result: unknown } | { ok: false; error: unknown },
): void {
  const params = request.params as Params;
  const info = describe(row, params, answer.ok ? answer.result : undefined, context);
  // A refused sign-in is a failed one, whatever refused it.
  const failedLogin = !answer.ok && row.failedEvent !== undefined;
  const outcome: AuditOutcome = answer.ok ? 'ok' : failedLogin ? 'failed' : outcomeOf(answer.error);
  const action = typeof row.action === 'function' ? row.action(params) : row.action;
  const message = answer.ok
    ? null
    : clipText(answer.error instanceof Error ? answer.error.message : String(answer.error));
  const subject = authorOf(context.actor) ?? info.subject ?? AUDIT_SYSTEM;
  try {
    context.services.audit.record({
      at: context.services.now(),
      subject,
      action: failedLogin ? row.failedEvent! : (row.event ?? action),
      repository: info.repository !== undefined ? info.repository : projectOf(params, context),
      resourceKind: info.resource?.kind ?? null,
      resourceId: info.resource?.id ?? null,
      outcome,
      details: { ...info.details, ...(failedLogin && message !== null ? { reason: message } : {}) },
      error: message,
    });
  } catch (error) {
    // The journal never undoes the action: the failure goes to the log of the daemon.
    context.log(
      `audit: cannot record ${request.method}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Runs a request and, in server mode, writes the methods that change something to the journal:
 * the outcome is `ok`, `denied` by the rights or `failed` with the error text. A method that only
 * reads, and the local mode, are not written.
 */
export async function audited(
  request: Request,
  context: IpcContext,
  run: () => Promise<unknown>,
): Promise<unknown> {
  const row = auditActions[request.method];
  if (context.actor.kind === 'local') return run();
  if (!row) return refusals(request, context, run);
  let result: unknown;
  try {
    result = await run();
  } catch (error) {
    record(request, row, context, { ok: false, error });
    throw error;
  }
  record(request, row, context, { ok: true, result });
  return result;
}

/** A method that only reads is not journaled, but a refusal of the rights is: who asked for what. */
async function refusals(
  request: Request,
  context: IpcContext,
  run: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError && error.responseCode === ACCESS_DENIED) {
      const action = actionOf(request.method, request.params as Params);
      record(request, { action: action ?? request.method }, context, { ok: false, error });
    }
    throw error;
  }
}
