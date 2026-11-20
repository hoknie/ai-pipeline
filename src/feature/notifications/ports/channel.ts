import type {
  ChannelStatus,
  Draw,
  ExternalRef,
  InboundInput,
  InboundResult,
  Language,
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

/** A chat the daemon writes to and listens to. Failures are `ChannelFailure`. */
export interface ChatChannelPort {
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
  /** The secret of the connection; read at the moment of a call. */
  secret: (slot: string) => Promise<string | null>;
  cursor: CursorStore;
}

/** A built-in kind of a channel: how to read its parameters and how to build its adapter. */
export interface ChannelFactoryPort {
  readonly kind: string;
  language(params: Readonly<Record<string, string>>): Language;
  /** Whether the user may act in the chat: the chat and the user are those the connection allows. */
  allows(params: Readonly<Record<string, string>>, chat: string, user: string): boolean;
  /** The name of a parameter a subscription cannot work without and the connection lacks. */
  missingForSubscription(params: Readonly<Record<string, string>>): string | null;
  create(options: ChannelOptions): ChatChannelPort;
}
