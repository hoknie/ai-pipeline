export type ShellTokenKind = 'comment' | 'string' | 'variable' | 'flag' | 'operator' | 'plain';

export interface ShellToken {
  kind: ShellTokenKind;
  text: string;
}

const PATTERN =
  /(#[^\n]*)|("(?:\\.|[^"\\\n])*"?|'[^'\n]*'?)|(\$(?:\{[^}\n]*\}?|\(|[A-Za-z_][A-Za-z0-9_]*|[0-9?$!#@*]))|((?<=\s|^)--?[A-Za-z0-9][\w-]*)|(&&|\|\||[|;&<>]+)/g;

const KINDS: ShellTokenKind[] = ['comment', 'string', 'variable', 'flag', 'operator'];

/** Splits shell text into tokens for highlighting; the texts joined give the source back. */
export function tokenizeShell(source: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let last = 0;
  for (const match of source.matchAll(PATTERN)) {
    const at = match.index;
    if (at > last) tokens.push({ kind: 'plain', text: source.slice(last, at) });
    const group = match.findIndex((value, index) => index > 0 && value !== undefined);
    tokens.push({ kind: KINDS[group - 1] ?? 'plain', text: match[0] });
    last = at + match[0].length;
  }
  if (last < source.length) tokens.push({ kind: 'plain', text: source.slice(last) });
  return tokens;
}
