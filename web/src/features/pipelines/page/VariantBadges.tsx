import { Badge } from '../../../shared/ui/feedback/badge.tsx';

/** The names of the variants a pipeline file describes: `name`, else the id. */
export function variantNamesOf(raw: Record<string, unknown>): { id: string; name: string }[] {
  const variants = raw.variants;
  if (typeof variants !== 'object' || variants === null || Array.isArray(variants)) return [];
  return Object.entries(variants).map(([id, value]) => {
    const name = (value as { name?: unknown } | null)?.name;
    return { id, name: typeof name === 'string' && name.trim() !== '' ? name.trim() : id };
  });
}

/** Small badges with the variants of a pipeline; nothing for a pipeline without variants. */
export function VariantBadges({ id, raw }: { id: string; raw: Record<string, unknown> }) {
  const names = variantNamesOf(raw);
  if (names.length === 0) return null;
  return (
    <span data-testid={`variants-${id}`} className="flex flex-wrap gap-1">
      {names.map((variant) => (
        <Badge key={variant.id} variant="outline" title={variant.id}>
          {variant.name}
        </Badge>
      ))}
    </span>
  );
}
