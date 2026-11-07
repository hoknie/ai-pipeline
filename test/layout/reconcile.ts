import type { Rule, Violation } from './check.ts';

export interface ExceptionEntry {
  rule: Rule;
  /** Путь от корня репозитория: `src/...` или `web/src/...`. */
  path: string;
  /** Функция или класс, если запись о них; для `purity` — внешняя зависимость (`node:fs`, `yaml`). */
  name?: string;
  /** Размер на момент записи: строки кода, методы, файлы в папке, 1 для `purity` (одна запись на зависимость), число `process.env`. */
  size: number;
}

/** Правила, нарушения которых можно записать в список; остальные не прощаются никогда. */
export const excusableRules: readonly Rule[] = [
  'file-size',
  'function-size',
  'folder-size',
  'class-size',
  'purity',
  'environment',
];

const keyOf = (entry: { rule: Rule; path: string; name?: string | undefined }): string =>
  `${entry.rule}|${entry.path}|${entry.name ?? ''}`;

/**
 * Сверяет нарушения со списком исключений. Возвращает сообщения: нарушение без записи,
 * размер выше записанного, запись, которая больше не нужна, повторная запись.
 */
export function reconcile(
  violations: Violation[],
  exceptions: readonly ExceptionEntry[],
): string[] {
  const problems: string[] = [];
  const recorded = new Map<string, ExceptionEntry>();
  for (const entry of exceptions) {
    const key = keyOf(entry);
    if (recorded.has(key)) problems.push(`${entry.path}: duplicate exception \`${entry.rule}\``);
    recorded.set(key, entry);
  }
  const used = new Set<string>();
  for (const found of violations) {
    if (!excusableRules.includes(found.rule)) {
      problems.push(found.message);
      continue;
    }
    const key = keyOf(found);
    const entry = recorded.get(key);
    if (!entry) {
      problems.push(`${found.message} [not in the exception list]`);
      continue;
    }
    used.add(key);
    if (found.size > entry.size) {
      problems.push(`${found.message} [grew: the exception list records ${entry.size}]`);
    }
  }
  for (const [key, entry] of recorded) {
    if (used.has(key)) continue;
    const what = entry.name === undefined ? entry.rule : `${entry.rule} \`${entry.name}\``;
    problems.push(`${entry.path}: exception ${what} is no longer needed, remove it from the list`);
  }
  return problems;
}
