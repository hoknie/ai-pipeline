import type { SQLInputValue } from 'node:sqlite';

/** A row as `node:sqlite` returns it. */
export type Row = Record<string, SQLInputValue>;

export function json(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export function parse<T>(value: SQLInputValue): T {
  return JSON.parse(String(value)) as T;
}

export function nullable<T>(value: SQLInputValue): T | null {
  return value === null ? null : parse<T>(value);
}

export function text(value: SQLInputValue): string | null {
  return value === null ? null : String(value);
}
