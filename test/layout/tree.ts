import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach } from 'vitest';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Временное дерево исходников: ключ — путь от корня, значение — текст файла. */
export function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'aip-layout-'));
  created.push(root);
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

/** Файл, который что-то экспортирует: у импортируемых файлов должно быть содержимое. */
export const stub = 'export const value = 1;\n';
