import { z } from 'zod';

import type { NamingPort } from '../../ports/index.ts';
import { firstJsonObject, fitNaming, type RunNaming } from '../../types/index.ts';

const namingSchema = z.object({ title: z.string(), name: z.string() });

/** Title and name from the first JSON object in the answer, or null when it does not fit. */
export function parseNaming(answer: string): RunNaming | null {
  const parsed = namingSchema.safeParse(firstJsonObject(answer));
  return parsed.success ? fitNaming(parsed.data) : null;
}

/** Reads the answer of the naming agent: the shape is checked by a schema at the boundary. */
export class NamingClient implements NamingPort {
  parse(answer: string): RunNaming | null {
    return parseNaming(answer);
  }
}
