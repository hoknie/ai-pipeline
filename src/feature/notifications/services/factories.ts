import type { ChannelFactoryPort } from '../ports/index.ts';

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

  kinds(): string[] {
    return [...this.factories.keys()];
  }
}
