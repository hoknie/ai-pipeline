/** The kinds of events a subscription may ask for; the first one is the default. */
export const EVENT_KINDS = ['question', 'failed', 'conflict', 'delivery', 'finished'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** The states of a line of the journal. */
export const DELIVERY_STATES = ['pending', 'sent', 'failed', 'closed'] as const;

/** The command that sets a secret: the panel never takes the value. */
export const secretCommand = (id: string, slot: string): string =>
  `aip integration secret set ${id} ${slot} --stdin`;

export const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure);
