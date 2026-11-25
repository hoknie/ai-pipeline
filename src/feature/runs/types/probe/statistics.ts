/** The smallest number of pairs a clean and an unclean probe must decide before a win is a signal. */
export const MIN_DECIDING_PAIRS = 6;

/** The level of significance every candidate is judged by. */
export const SIGNIFICANCE_LEVEL = 0.05;

/** `n choose k`, exact for the small counts of probe repetitions. */
export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const small = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= small; index += 1) {
    result = (result * (n - small + index)) / index;
  }
  return Math.round(result);
}

/**
 * Two-sided exact sign test of `wins` against `losses`: the chance that an unbiased coin would
 * split `wins + losses` decided pairs at least this unevenly. One bit per repetition, as the
 * epic says, so the count must be large enough before a difference counts.
 */
export function signTestP(wins: number, losses: number): number {
  const decided = wins + losses;
  if (decided === 0) return 1;
  const tail = Math.min(wins, losses);
  let sum = 0;
  for (let count = 0; count <= tail; count += 1) sum += combinations(decided, count);
  const p = (2 * sum) / 2 ** decided;
  return Math.min(1, p);
}

/** Whether a difference is a signal: enough decided pairs and a p-value below the level. */
export function isSignificant(wins: number, losses: number): boolean {
  return wins + losses >= MIN_DECIDING_PAIRS && signTestP(wins, losses) < SIGNIFICANCE_LEVEL;
}
