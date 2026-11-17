/** The label of a provider: its name, and the slug when the name is not known. */
export function providerLabel(slug: string, name?: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : slug;
}
