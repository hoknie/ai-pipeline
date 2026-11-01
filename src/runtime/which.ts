import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

export function findExecutable(name: string, path = process.env.PATH ?? ''): string | null {
  const candidates = isAbsolute(name)
    ? [name]
    : path
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, name));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}
