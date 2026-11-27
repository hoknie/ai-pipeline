import type { Node } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { Step, StepResult } from 'prosemirror-transform';
import { preserveEditorBlocks } from './preserveEditorBlocks.ts';

/** An invertible source patch travels with the model edit in ProseMirror history.
 * It changes no model positions. Storing only the differing range avoids retaining
 * two copies of the whole task for every keystroke in a grouped history event.
 */
export class MarkdownSourceStep extends Step {
  readonly from: number;
  readonly removed: string;
  readonly inserted: string;

  constructor(from: number, removed: string, inserted: string) {
    super();
    this.from = from;
    this.removed = removed;
    this.inserted = inserted;
  }

  apply(doc: Node): StepResult {
    return StepResult.ok(doc);
  }

  invert(): MarkdownSourceStep {
    return new MarkdownSourceStep(this.from, this.inserted, this.removed);
  }

  map(): MarkdownSourceStep {
    return this;
  }

  patch(source: string): string | null {
    if (source.slice(this.from, this.from + this.removed.length) !== this.removed) return null;
    return (
      source.slice(0, this.from) + this.inserted + source.slice(this.from + this.removed.length)
    );
  }

  toJSON() {
    return {
      stepType: 'aipMarkdownSource',
      from: this.from,
      removed: this.removed,
      inserted: this.inserted,
    };
  }

  static fromJSON(_schema: unknown, json: { from: number; removed: string; inserted: string }) {
    if (
      !Number.isSafeInteger(json.from) ||
      json.from < 0 ||
      typeof json.removed !== 'string' ||
      typeof json.inserted !== 'string'
    )
      throw new RangeError('Invalid Markdown source history step');
    return new MarkdownSourceStep(json.from, json.removed, json.inserted);
  }
}

Step.jsonID('aipMarkdownSource', MarkdownSourceStep);

function sourceDiff(before: string, after: string): MarkdownSourceStep {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let end = 0;
  while (
    end < before.length - from &&
    end < after.length - from &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++;
  return new MarkdownSourceStep(
    from,
    before.slice(from, before.length - end),
    after.slice(from, after.length - end),
  );
}

/** Call before applying the transaction so its source patch is recorded in the same event. */
export function sourceForTransaction(
  source: string,
  previous: Node,
  transaction: Transaction,
): string {
  const patches = transaction.steps.filter((step) => step instanceof MarkdownSourceStep);
  if (patches.length) {
    let restored: string | null = source;
    for (const patch of patches) restored = restored === null ? null : patch.patch(restored);
    if (restored !== null) return restored;
    // A stale/rebased source patch must not overwrite a newer external draft.
    return preserveEditorBlocks(source, previous, transaction.doc);
  }
  const next = preserveEditorBlocks(source, previous, transaction.doc);
  transaction.step(sourceDiff(source, next));
  return next;
}
