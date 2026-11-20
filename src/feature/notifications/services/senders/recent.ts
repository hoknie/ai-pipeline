/** A person who wrote to a chat of a connection: the id of the chat service and a display name. */
export interface Person {
  user: string;
  label: string | null;
}

export interface Sender extends Person {
  /** When the person was last seen, ms. */
  at: number;
}

export const SENDERS_PER_CONNECTION = 20;
export const SENDER_TTL_MS = 7 * 24 * 3600 * 1000;
export const LABEL_LIMIT = 64;

/** The display name of a stranger: control characters gone, cut to the limit; null when nothing is left. */
function cleanLabel(label: string | null): string | null {
  if (label === null) return null;
  const text = label.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim();
  return text === '' ? null : Array.from(text).slice(0, LABEL_LIMIT).join('');
}

/** Who wrote to the chats lately, per connection; in memory only, a restart of the daemon forgets it. */
export class RecentSenders {
  private readonly rows = new Map<string, Sender[]>();

  note(connectionId: string, person: Person, at: number): void {
    const rest = (this.rows.get(connectionId) ?? []).filter((one) => one.user !== person.user);
    const label = cleanLabel(person.label);
    this.rows.set(
      connectionId,
      [{ user: person.user, label, at }, ...rest].slice(0, SENDERS_PER_CONNECTION),
    );
  }

  /** The people seen within the last seven days, the latest first. */
  list(connectionId: string, now: number): Sender[] {
    const fresh = (this.rows.get(connectionId) ?? []).filter((one) => now - one.at < SENDER_TTL_MS);
    if (fresh.length === 0) this.rows.delete(connectionId);
    else this.rows.set(connectionId, fresh);
    return fresh.map((one) => ({ ...one }));
  }

  clear(connectionId: string): void {
    this.rows.delete(connectionId);
  }
}
