import type { TagColor } from '../../../../feature/tags/types/index.ts';

/** A catalog tag as clients see it. */
export interface TagView {
  id: string;
  repository: string;
  name: string;
  color: TagColor;
  task: { run: string; number: number } | null;
}
