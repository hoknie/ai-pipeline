/** `name` written in the file of a pipeline, if it is a non-empty string. */
export function rawName(raw: Record<string, unknown>): string | null {
  return typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : null;
}
