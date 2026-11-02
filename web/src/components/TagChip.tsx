import { cn } from '../lib/cn.ts';
import { TAG_CLASSES } from '../tagColors.ts';
import { useTags } from '../tags.tsx';
import type { TagView } from '../types.ts';

/** A tag chip with the color of its tag. */
export function TagLabel({ tag, className }: { tag: TagView; className?: string }) {
  return (
    <span
      data-tag={tag.id}
      className={cn(
        'inline-flex max-w-40 items-center truncate rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TAG_CLASSES[tag.color] ?? TAG_CLASSES.gray,
        className,
      )}
      title={tag.name}
    >
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

/** The chip of a tag id: name and color come from the current catalog; a tag not in it is not shown. */
export function TagChip({ id, className }: { id: string; className?: string }) {
  const tag = useTags().byId.get(id);
  return tag ? <TagLabel tag={tag} className={className} /> : null;
}

/** Chips of tags in their order; nothing (no wrapper) when none of them is in the catalog. */
export function TagChips({ tags, className }: { tags: { id: string }[]; className?: string }) {
  const { byId } = useTags();
  const known = tags.filter((tag) => byId.has(tag.id));
  if (known.length === 0) return null;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)} data-tags>
      {known.map((tag) => (
        <TagChip key={tag.id} id={tag.id} />
      ))}
    </span>
  );
}
