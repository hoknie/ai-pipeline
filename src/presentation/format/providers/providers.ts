/** `<slug> (<name>)`; only the slug when the name is not known. */
export function providerText(slug: string, name?: string | null): string {
  return name ? `${slug} (${name})` : slug;
}

/** Who a usage limit holds: `zai (Z.ai, opencode)` for a provider, the runtime alone otherwise. */
export function limitOwnerText(owner: {
  runtime: string;
  provider?: string;
  providerName?: string | null;
}): string {
  if (!owner.provider) return owner.runtime;
  return owner.providerName
    ? `${owner.provider} (${owner.providerName}, ${owner.runtime})`
    : `${owner.provider} (${owner.runtime})`;
}
