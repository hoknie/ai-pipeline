import type { VerifiedToken, VerifyContext } from '../ports/index.ts';
import {
  EVENT_ID_PATTERN,
  isOperation,
  refusal,
  trimMeta,
  type AcceptedEvent,
  type IgnoredEvent,
} from '../types/index.ts';

/** What a verifier proved about one delivery. */
export type VerifiedEvent = AcceptedEvent | IgnoredEvent;

export function isIgnored(event: VerifiedEvent): event is IgnoredEvent {
  return 'ignored' in event;
}

interface Grant {
  event: VerifiedEvent | null;
  used: boolean;
}

/** A proof issued to one verifier for one delivery. */
export interface Session {
  /** The part of the context that issues the proof. */
  issuers: Pick<VerifyContext, 'accept' | 'ignore'>;
  /** The event the proof stands for; throws unless the token is the one this session issued. */
  redeem(token: VerifiedToken | null): VerifiedEvent;
}

/**
 * The proofs the gate issues to verifiers. A token is valid only for the session that issued it,
 * and only once: a forged structure or a token of another delivery is not in the map.
 */
export class ProofIssuer {
  private readonly grants = new WeakMap<object, Grant>();

  open(): Session {
    const grant: Grant = { event: null, used: false };
    const issue = (event: VerifiedEvent): VerifiedToken => {
      const token: VerifiedToken = Object.freeze({ brand: 'verified' as const });
      grant.event = event;
      this.grants.set(token, grant);
      return token;
    };
    return {
      issuers: {
        accept: (event) => {
          if (!EVENT_ID_PATTERN.test(event.externalEventId) || !isOperation(event.operation)) {
            throw refusal('unauthenticated');
          }
          const meta = trimMeta(event.meta);
          return issue({ ...event, ...(meta === undefined ? {} : { meta }) });
        },
        ignore: (externalEventId, reason, meta) => {
          if (!EVENT_ID_PATTERN.test(externalEventId) || !EVENT_ID_PATTERN.test(reason)) {
            throw refusal('unauthenticated');
          }
          const trimmed = trimMeta(meta);
          return issue({
            externalEventId,
            ignored: reason,
            ...(trimmed === undefined ? {} : { meta: trimmed }),
          });
        },
      },
      redeem: (token) => {
        const issued = token === null ? undefined : this.grants.get(token);
        if (issued !== grant || grant.used || grant.event === null) {
          throw refusal('unauthenticated');
        }
        grant.used = true;
        return grant.event;
      },
    };
  }
}
