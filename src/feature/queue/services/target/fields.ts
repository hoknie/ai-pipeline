import type { ItemFields, TaskFields } from "../../types/index.ts";

/** The fields of a new item without the tags, which are resolved separately. */
export function fields(
  request: TaskFields & Pick<ItemFields, 'postponed' | 'author' | 'createdBySystem'>,
): ItemFields {
  const {
    pipeline,
    variant,
    provider,
    task,
    groups,
    title,
    autoDeliver,
    deliveryMode,
    deliveryBranch,
  } = request;
  const { skip, after, inheritTags, postponed, author, createdBySystem } = request;
  return {
    ...{
      pipeline,
      variant,
      provider,
      task,
      groups,
      title,
      autoDeliver,
      deliveryMode,
      deliveryBranch,
    },
    ...{ skip, after, inheritTags, postponed, author, createdBySystem },
  };
}

