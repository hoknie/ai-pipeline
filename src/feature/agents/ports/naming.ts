import type { RunNaming } from '../types/index.ts';

/** Reads the title and the name of a run from the answer of the naming agent. */
export interface NamingPort {
  parse(answer: string): RunNaming | null;
}
