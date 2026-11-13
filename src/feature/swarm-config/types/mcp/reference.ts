/** A piece of a value of an MCP server: literal text or a reference `${NAME}` to a variable. */
export type ReferenceToken = { text: string } | { variable: string };

export type ParsedReferences = { tokens: ReferenceToken[] } | { error: string };

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Splits a value into literal text and references `${NAME}`. `$${` stands for the literal text
 * `${`; a `$` that does not open a reference is literal as well.
 */
export function parseReferences(value: string): ParsedReferences {
  const tokens: ReferenceToken[] = [];
  let text = '';
  let index = 0;
  while (index < value.length) {
    if (value.startsWith('$${', index)) {
      text += '$';
      index += 2;
    } else if (value.startsWith('${', index)) {
      const end = value.indexOf('}', index);
      if (end < 0) return { error: 'has an unclosed reference "${"' };
      const name = value.slice(index + 2, end);
      if (!VARIABLE_NAME.test(name)) {
        return {
          error: `has an invalid reference "\${${name}}": use \${NAME} with a variable name`,
        };
      }
      if (text !== '') tokens.push({ text });
      text = '';
      tokens.push({ variable: name });
      index = end + 1;
    } else {
      text += value[index];
      index += 1;
    }
  }
  if (text !== '') tokens.push({ text });
  return { tokens };
}
