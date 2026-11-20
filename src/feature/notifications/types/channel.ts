/** A failure of a channel as the core needs it: retry, wait or give up; the text is always safe. */
export class ChannelFailure extends Error {
  /** Retrying cannot help: a wrong token, no access to the chat, a wrong request. */
  readonly permanent: boolean;
  /** The channel asked to wait this long (ms). */
  readonly retryAfterMs: number | null;
  /** The channel does not accept the credentials of the connection. */
  readonly unauthorized: boolean;
  /** The receiver is gone for good: the connection is switched off at once. */
  readonly disable: boolean;

  constructor(
    message: string,
    options: {
      permanent: boolean;
      retryAfterMs?: number | null;
      unauthorized?: boolean;
      disable?: boolean;
    },
  ) {
    super(message);
    this.name = 'ChannelFailure';
    this.permanent = options.permanent;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.unauthorized = options.unauthorized ?? false;
    this.disable = options.disable ?? false;
  }
}

/** What a channel hands to the core when someone acts in the chat. */
export type InboundInput =
  | {
      type: 'action';
      /** Unique per event of the channel; claimed once. */
      event: string;
      chat: string;
      user: string;
      shortKey: string;
      /** The action of the button without the key: `o:1:2`, `r`, `c`, `a`, `f`. */
      action: string;
    }
  | {
      type: 'text';
      event: string;
      chat: string;
      user: string;
      text: string;
      /** What the text answers: the short key of a prompt, or the message it was written to. */
      target: { shortKey: string | null; message: string | null };
    };

/** What the core did with an input, for the channel to tell the user. */
export type InboundResult =
  | { kind: 'selected' | 'sent' | 'forbidden' | 'closed' | 'format' | 'waiting' | 'ignored' }
  | { kind: 'prompt'; shortKey: string; questions: number };

export type ChannelStatus =
  { state: 'listening' } | { state: 'error'; error: string; unauthorized: boolean };
