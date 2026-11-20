import type { IntegrationAdapterPort } from '../ports/index.ts';
import { refusal, type CatalogEntry } from '../types/index.ts';

/**
 * The kinds this build of `aip` knows: the built-in adapters the composition root registers. Nothing
 * else is loaded, so an unknown kind is refused before anything is written or called.
 */
export class AdapterCatalog {
  private readonly adapters = new Map<string, IntegrationAdapterPort>();

  constructor(adapters: readonly IntegrationAdapterPort[]) {
    for (const adapter of adapters) {
      const kind = adapter.descriptor.kind;
      if (this.adapters.has(kind)) throw new Error(`integration kind ${kind} is registered twice`);
      this.adapters.set(kind, adapter);
    }
  }

  entries(): CatalogEntry[] {
    return [...this.adapters.values()].map(({ descriptor }) => ({
      kind: descriptor.kind,
      title: descriptor.title,
      params: descriptor.params,
      secrets: descriptor.secrets,
      directions: descriptor.directions,
      operations: descriptor.operations,
      ...(descriptor.createdBy === undefined ? {} : { createdBy: descriptor.createdBy }),
    }));
  }

  has(kind: string): boolean {
    return this.adapters.has(kind);
  }

  /** The adapter of a kind; an unknown kind is refused. */
  adapter(kind: string): IntegrationAdapterPort {
    const adapter = this.adapters.get(kind);
    if (adapter === undefined) throw refusal('unknown_kind');
    return adapter;
  }
}
