import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse, stringify } from 'yaml';

/**
 * Lays a configuration written as one `swarm:` document out as the `aip/` directory of a
 * repository, replacing whatever was there.
 */
export function writeConfigDirectory(repo: string, text: string): void {
  writeLevelDirectory(join(repo, 'aip'), text);
}

/** The same for an arbitrary level directory, such as `~/.config/aip`. */
export function writeLevelDirectory(directory: string, text: string): void {
  rmSync(directory, { recursive: true, force: true });
  const root = (parse(text) ?? {}) as { swarm?: Record<string, unknown> };
  const { specialists, pipelines, actions, chains, ...settings } = root.swarm ?? {};
  mkdirSync(directory, { recursive: true });
  if (root.swarm !== undefined) {
    writeFileSync(join(directory, 'settings.yaml'), stringify(settings));
  }
  for (const [section, entries] of [
    ['specialists', specialists],
    ['pipelines', pipelines],
    ['actions', actions],
    ['chains', chains],
  ] as const) {
    if (entries === undefined || entries === null || typeof entries !== 'object') continue;
    mkdirSync(join(directory, section), { recursive: true });
    for (const [name, value] of Object.entries(entries)) {
      writeFileSync(join(directory, section, `${name}.yaml`), stringify(value));
    }
  }
}
