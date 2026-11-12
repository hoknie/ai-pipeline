import type { CommandRunner, ModelEntry, RuntimeExtra, RuntimeModels } from '../../types/index.ts';

const MODELS_TIMEOUT_MS = 15_000;
const MODEL_LINE = /^([^\s/]+)\/(\S+)$/;

/** `provider/model` lines of `opencode models`; banners and warnings are dropped. */
export function parseOpencodeModels(text: string): ModelEntry[] {
  const seen = new Map<string, ModelEntry>();
  for (const line of text.split('\n')) {
    const match = MODEL_LINE.exec(line.trim());
    if (!match) continue;
    const id = `${match[1]}/${match[2]}`;
    if (!seen.has(id)) seen.set(id, { id, name: match[2]!, group: match[1]! });
  }
  return [...seen.values()].sort((a, b) =>
    a.id.toLowerCase().localeCompare(b.id.toLowerCase(), 'en'),
  );
}

function failureText(error: unknown, executable: string): string {
  if ((error as { code?: unknown } | null)?.code === 'ENOENT') {
    return `${executable}: command not found`;
  }
  const message = error instanceof Error ? error.message : String(error);
  const line = message.split('\n').find((part) => part.trim() !== '') ?? 'command failed';
  return line.trim().slice(0, 200);
}

/** Runs `opencode models` in `directory` with the executable, arguments and environment of the runtime. */
export async function listOpencodeModels(
  executable: string,
  extra: RuntimeExtra,
  directory: string,
  run: CommandRunner,
): Promise<RuntimeModels> {
  try {
    const { stdout } = await run(executable, [...extra.args, 'models'], {
      cwd: directory,
      env: extra.env,
      timeout: MODELS_TIMEOUT_MS,
    });
    return { models: parseOpencodeModels(stdout), error: null };
  } catch (error) {
    return { models: [], error: failureText(error, executable) };
  }
}
