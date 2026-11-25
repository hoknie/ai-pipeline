/**
 * What an attempt learns from the history of its repository: `full` is everything today's runs
 * get (the configuration skills and the lessons of the finished runs), `none` is the same run
 * without the lessons. A probe runs a task in the other harness to compare the two.
 */
export const HARNESSES = ['full', 'none'] as const;

export type Harness = (typeof HARNESSES)[number];

/** The harness of every run that is not a probe. */
export const DEFAULT_HARNESS: Harness = 'full';

/** The harness a probe of the run gets: the other one, so a probe of a probe comes back. */
export function oppositeHarness(harness: Harness): Harness {
  return harness === 'full' ? 'none' : 'full';
}

export function isHarness(value: unknown): value is Harness {
  return HARNESSES.includes(value as Harness);
}
