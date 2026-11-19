const KEY = 'Co-Authored-By';

/** The lines of the last paragraph are all trailers (`Key: value`) and it is not the subject. */
function endsWithTrailers(paragraphs: string[]): boolean {
  if (paragraphs.length < 2) return false;
  const last = paragraphs[paragraphs.length - 1] ?? '';
  return last.split('\n').every((line) => /^[A-Za-z][A-Za-z0-9-]*: \S/.test(line));
}

/**
 * The message with `Co-Authored-By: <trailer>` at its end, after an empty line, or straight after
 * the trailers it already ends with. A message that has this trailer already is not changed.
 */
export function withTrailer(message: string, trailer: string): string {
  const line = `${KEY}: ${trailer.trim()}`;
  const text = message.trimEnd();
  if (text.split('\n').some((existing) => existing.trim().toLowerCase() === line.toLowerCase())) {
    return message;
  }
  const paragraphs = text.split(/\n{2,}/);
  return endsWithTrailers(paragraphs) ? `${text}\n${line}` : `${text}\n\n${line}`;
}
