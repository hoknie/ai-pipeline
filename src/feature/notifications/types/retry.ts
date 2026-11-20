/** How a channel kind is retried after a refusal and what a run of refusals does to its connection. */
export interface RetryPolicy {
  /** The pauses before the next attempt; the delivery has one attempt more than there are pauses. */
  pausesMs: readonly number[];
  /** A delivery older than this (ms) is given up on; null: the pauses alone decide. */
  giveUpMs: number | null;
  /** A pause the receiver asks for is cut down to the next pause of the schedule. */
  capRetryAfter: boolean;
  /** The connection is switched off after this many failed deliveries in a row; null: never. */
  disableAfterFailures: number | null;
  /** How many requests of one connection are in flight at once. */
  concurrency: number;
}

/** The chats: a few quick retries inside an hour, one message at a time so the order holds. */
export const CHAT_RETRY: RetryPolicy = {
  pausesMs: [5_000, 30_000, 120_000, 600_000, 1_800_000],
  giveUpMs: 3_600_000,
  capRetryAfter: false,
  disableAfterFailures: null,
  concurrency: 1,
};

/**
 * When the next attempt of a delivery that just failed is due (ms from now); null: no more
 * attempts. `attempts` counts the attempts made, this one included.
 */
export function retryDelay(
  policy: RetryPolicy,
  attempts: number,
  failure: { permanent: boolean; retryAfterMs: number | null },
  age: number,
): number | null {
  if (failure.permanent) return null;
  const pause = policy.pausesMs[attempts - 1];
  if (pause === undefined)
    return failure.retryAfterMs !== null && !policy.capRetryAfter ? failure.retryAfterMs : null;
  const asked = failure.retryAfterMs;
  const delay =
    asked === null ? pause : policy.capRetryAfter ? Math.min(Math.max(asked, 0), pause) : asked;
  if (policy.giveUpMs !== null && age + delay >= policy.giveUpMs) return null;
  return delay;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** A webhook: eight attempts in about a day, three failed deliveries in a row switch it off. */
export const WEBHOOK_RETRY: RetryPolicy = {
  pausesMs: [5_000, MINUTE, 10 * MINUTE, HOUR, 3 * HOUR, 7 * HOUR, 11 * HOUR],
  giveUpMs: null,
  capRetryAfter: true,
  disableAfterFailures: 3,
  concurrency: 4,
};
