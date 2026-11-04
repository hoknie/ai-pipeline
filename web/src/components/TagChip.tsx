import type { SyntheticEvent } from 'react';

import { cn } from '../lib/cn.ts';
import { TAG_CLASSES } from '../tagColors.ts';
import { useTags } from '../tags.tsx';
import type { TagView } from '../types.ts';

/** The text of a chip: `#N: name` for a tag of a linked task, the name otherwise. */
export function tagText(tag: TagView): string {
  return tag.task ? `#${tag.task.number}: ${tag.name}` : tag.name;
}

const CHIP =
  'inline-flex max-w-40 items-center truncate rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';

/**
 * A tag chip with the color of its tag. A tag of a linked task is a link to that task; inside
 * a button (`nested`) it is a `span` with `role="link"`, since a link cannot sit in a button.
 */
export function TagLabel({
  tag,
  className,
  nested = false,
}: {
  tag: TagView;
  className?: string;
  nested?: boolean;
}) {
  const classes = cn(CHIP, TAG_CLASSES[tag.color] ?? TAG_CLASSES.gray, className);
  const text = tagText(tag);
  if (!tag.task) {
    return (
      <span data-tag={tag.id} className={classes} title={text}>
        <span className="truncate">{text}</span>
      </span>
    );
  }
  const href = `#runs/${encodeURIComponent(tag.task.run)}`;
  if (nested) {
    const open = (event: SyntheticEvent) => {
      event.stopPropagation();
      window.location.hash = href;
    };
    return (
      <span
        data-tag={tag.id}
        role="link"
        tabIndex={0}
        className={cn(classes, 'cursor-pointer hover:underline')}
        title={text}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            open(event);
          }
        }}
      >
        <span className="truncate">{text}</span>
      </span>
    );
  }
  return (
    <a
      data-tag={tag.id}
      href={href}
      className={cn(classes, 'hover:underline')}
      title={text}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="truncate">{text}</span>
    </a>
  );
}

/** The chip of a tag id: name and color come from the current catalog; a tag not in it is not shown. */
export function TagChip({
  id,
  className,
  nested = false,
}: {
  id: string;
  className?: string;
  nested?: boolean;
}) {
  const tag = useTags().byId.get(id);
  return tag ? <TagLabel tag={tag} className={className} nested={nested} /> : null;
}

/** Chips of tags in their order; nothing (no wrapper) when none of them is in the catalog. */
export function TagChips({
  tags,
  className,
  nested = false,
}: {
  tags: { id: string }[];
  className?: string;
  nested?: boolean;
}) {
  const { byId } = useTags();
  const known = tags.filter((tag) => byId.has(tag.id));
  if (known.length === 0) return null;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)} data-tags>
      {known.map((tag) => (
        <TagChip key={tag.id} id={tag.id} nested={nested} />
      ))}
    </span>
  );
}
