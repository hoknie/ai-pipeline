import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Strip JSONC comments and trailing commas without changing strings. */
function jsonc(text: string): unknown {
  let clean = '';
  let string = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (string) {
      clean += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') string = false;
    } else if (c === '"') {
      string = true;
      clean += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      clean += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment');
      i = end + 1;
      clean += ' ';
    } else clean += c;
  }
  let result = '';
  string = false;
  escape = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i] ?? '';
    if (string) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') string = false;
    } else if (c === '"') string = true;
    else if (c === ',') {
      let next = i + 1;
      while (next < clean.length && /\s/.test(clean[next] ?? '')) next++;
      if (clean[next] === '}' || clean[next] === ']') continue;
    }
    result += c;
  }
  return JSON.parse(result) as unknown;
}

export function userServerNames(worktree: string, env: NodeJS.ProcessEnv): string[] {
  const global = join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'opencode');
  const dirs = [global, worktree, join(worktree, '.opencode')];
  const names = new Set<string>();
  for (const dir of dirs)
    for (const file of ['opencode.json', 'opencode.jsonc']) {
      const path = join(dir, file);
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new Error(`cannot read ${path}: ${(error as Error).message}`);
      }
      try {
        const data = jsonc(text);
        if (typeof data !== 'object' || data === null || Array.isArray(data))
          throw new Error('expected object');
        const mcp = (data as Record<string, unknown>).mcp;
        if (mcp !== undefined && (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)))
          throw new Error('mcp must be an object');
        for (const name of Object.keys(mcp ?? {})) names.add(name);
      } catch (error) {
        throw new Error(`invalid ${path}: ${(error as Error).message}`);
      }
    }
  return [...names];
}
