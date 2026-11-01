export interface StepIdSource {
  specialist: string;
  /** The id follows the specialist. */
  autoId: boolean;
  /** The id kept from the file when `autoId` is false. */
  fixedId: string;
}

/**
 * The ids of the steps: the own id of a step is kept, the others are the slug of the
 * specialist, with `-2`, `-3`, … when the id is taken. A step without a specialist has no id.
 */
export function stepIds(steps: readonly StepIdSource[]): string[] {
  const taken = new Set(steps.filter((step) => !step.autoId).map((step) => step.fixedId));
  return steps.map((step) => {
    if (!step.autoId) return step.fixedId;
    if (step.specialist === '') return '';
    let id = step.specialist;
    for (let n = 2; taken.has(id); n++) id = `${step.specialist}-${n}`;
    taken.add(id);
    return id;
  });
}
