import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { configPaths } from '../config/index.ts';
import { repositoryRoot } from '../git/index.ts';

/** The starter configuration shipped with the package. */
const TEMPLATE = join(import.meta.dirname, '..', '..', 'templates', 'aip');

export interface InitOptions {
  cwd: string;
  /** Write to the shared configuration instead of the repository. */
  shared: boolean;
  env: NodeJS.ProcessEnv;
}

export interface InitResult {
  directory: string;
  /** Absolute paths. */
  created: string[];
  kept: string[];
  /** Root of the repository the configuration was written to; null for the shared configuration. */
  repository: string | null;
}

function templateFiles(directory = TEMPLATE): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? templateFiles(join(directory, entry.name))
        : [join(directory, entry.name)],
    )
    .sort();
}

/** Copies the starter configuration into `aip/` of the repository; existing files stay as they are. */
export async function initConfig(options: InitOptions): Promise<InitResult> {
  let directory: string;
  let root: string | null = null;
  if (options.shared) {
    directory = configPaths('', options.env.XDG_CONFIG_HOME, options.env.HOME).global.directory;
  } else {
    const repository = await repositoryRoot(options.cwd).catch(() => {
      throw new Error(
        `${options.cwd} is not inside a git repository. Run \`git init\` first, or use \`aip init --shared\` for the shared configuration.`,
      );
    });
    root = repository;
    directory = configPaths(repository, undefined, undefined).project.directory;
  }
  const created: string[] = [];
  const kept: string[] = [];
  for (const source of templateFiles()) {
    const target = join(directory, relative(TEMPLATE, source));
    if (existsSync(target)) {
      kept.push(target);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source));
    created.push(target);
  }
  return { directory, created, kept, repository: root };
}
