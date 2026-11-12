/** A model a specialist of a runtime can name. */
export interface ModelEntry {
  /** The value of `model` in the configuration. */
  id: string;
  /** The short name shown next to the id. */
  name: string;
  /** The heading of the group; `aliases` is the group of short aliases. */
  group: string;
}

/** The models of one runtime; `error` is set when listing them failed. */
export interface RuntimeModels {
  models: ModelEntry[];
  error: string | null;
}

export interface ModelCatalogs {
  claude: RuntimeModels;
  opencode: RuntimeModels;
  agy: RuntimeModels;
}

export interface CommandOptions {
  cwd: string;
  env: Record<string, string>;
  /** Milliseconds. */
  timeout: number;
}

/** Runs a short command; rejects on a non-zero exit code, a timeout or a missing executable. */
export type CommandRunner = (
  file: string,
  args: string[],
  options: CommandOptions,
) => Promise<{ stdout: string }>;
