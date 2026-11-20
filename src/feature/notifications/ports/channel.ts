import type {
  AttemptRecord,
  ChannelStatus,
  Delivery,
  Draw,
  ExternalRef,
  InboundInput,
  InboundResult,
  Language,
  RetryPolicy,
} from '../types/index.ts';

/** A connection of a channel kind as the adapter needs it: its parameters, never its secrets. */
export interface ChannelConnection {
  id: string;
  name: string;
  kind: string;
  params: Readonly<Record<string, string>>;
}

/** What the core does with an input of the chat. */
export interface InboundHandler {
  handle(input: InboundInput): Promise<InboundResult>;
}

/** Where the adapter keeps how far it has read; the core stores it in the database. */
export interface CursorStore {
  get(): string | null;
  set(value: string): void;
}

/** What the core hands to a channel to send: the delivery and, for a chat, how to draw it. */
export interface OutboundMessage {
  delivery: Delivery;
  draw: Draw;
  /** The address of the panel for links, or null when the owner set none. */
  publicUrl: string | null;
}

/** A receiver the daemon writes to. Failures are `ChannelFailure`. */
export interface OutboundChannelPort {
  /** Sends the event of a delivery; returns where it landed. */
  deliver(message: OutboundMessage): Promise<ExternalRef>;
}

/** A chat the daemon writes to and listens to: messages that are edited, answers that come back. */
export interface ChatChannelPort extends OutboundChannelPort {
  /** Sends a new message to the chat of the connection; returns where it landed. */
  send(draw: Draw, shortKey: string): Promise<ExternalRef>;
  /** Redraws a sent message, in the chat it was sent to. */
  update(ref: ExternalRef, draw: Draw, shortKey: string): Promise<void>;
  /** A plain text to the chat of the connection. */
  sendText(text: string): Promise<ExternalRef>;
  /** Receives until the signal aborts; reports every change of the state of the channel. */
  listen(
    handler: InboundHandler,
    signal: AbortSignal,
    report: (status: ChannelStatus) => void,
  ): Promise<void>;
}

export interface ChannelOptions {
  connection: ChannelConnection;
  /** The clock of the daemon, for the stamps a channel puts on what it sends. */
  now?: () => number;
  /** Records one attempt of a delivery; channels that keep a log of attempts call it. */
  record?: (deliveryId: number, attempt: AttemptRecord) => void;
  /** The secret of the connection; read at the moment of a call. */
  secret: (slot: string) => Promise<string | null>;
  cursor: CursorStore;
  /** A person was seen writing to the chat: pressing a button, replying, asking for the ids. */
  seen?: (person: { user: string; label: string | null }) => void;
}

/** A built-in kind of a channel: how to read its parameters and how to build its adapter. */
export interface ChannelFactoryPort {
  readonly kind: string;
  language(params: Readonly<Record<string, string>>): Language;
  /** Whether the user may act in the chat: the chat and the user are those the connection allows. */
  allows(params: Readonly<Record<string, string>>, chat: string, user: string): boolean;
  /** The name of a parameter a subscription cannot work without and the connection lacks. */
  missingForSubscription(params: Readonly<Record<string, string>>): string | null;
  /** The retries of the kind; absent: those of a chat. */
  readonly retry?: RetryPolicy;
  /** The kind edits the message of a closed question; absent: it does. */
  readonly editsMessages?: boolean;
  create(options: ChannelOptions): OutboundChannelPort;
}

/** A built-in kind that is a chat. */
export interface ChatChannelFactoryPort extends ChannelFactoryPort {
  create(options: ChannelOptions): ChatChannelPort;
}
