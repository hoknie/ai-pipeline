import type { ChannelFactoryPort, ChatChannelPort, OutboundChannelPort } from '../ports/index.ts';

/** A channel that edits its messages and listens, as against one that only sends. */
export function isChatChannel(channel: OutboundChannelPort): channel is ChatChannelPort {
  return typeof (channel as Partial<ChatChannelPort>).listen === 'function';
}

/** The channel kinds this build knows, by the kind of the connection. */
export class ChannelFactories {
  private readonly factories = new Map<string, ChannelFactoryPort>();

  constructor(factories: readonly ChannelFactoryPort[]) {
    for (const factory of factories) {
      if (this.factories.has(factory.kind)) {
        throw new Error(`channel kind ${factory.kind} is registered twice`);
      }
      this.factories.set(factory.kind, factory);
    }
  }

  has(kind: string): boolean {
    return this.factories.has(kind);
  }

  get(kind: string): ChannelFactoryPort | undefined {
    return this.factories.get(kind);
  }

  /** The kind is a chat: it edits its messages and takes answers, and `notify` works with it. */
  isChat(kind: string): boolean {
    const factory = this.factories.get(kind);
    return factory !== undefined && factory.editsMessages !== false;
  }

  kinds(): string[] {
    return [...this.factories.keys()];
  }
}
