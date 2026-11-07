import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** Root of the package: the folder with `package.json`, both from the sources and the build. */
export function packageRoot(): string {
  return join(import.meta.dirname, '..', '..', '..');
}

/** Root of the running code tree: `src/` when run from the sources, `dist/` from the build. */
export function codeRoot(): string {
  return join(import.meta.dirname, '..', '..');
}

/** Version from `package.json`, so `npm version` updates it. */
export function packageVersion(): string {
  return (require('../../../package.json') as { version: string }).version;
}
