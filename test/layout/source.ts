import { readFileSync } from 'node:fs';

import { parseSync } from 'oxc-parser';

export interface SourceImport {
  specifier: string;
  /** Тип стирается при сборке: `import type`, `export type … from`, все имена с `type`. */
  typeOnly: boolean;
  dynamic: boolean;
  reexport: boolean;
  line: number;
}

export interface SourceFunction {
  name: string;
  line: number;
  /** Строки кода: без пустых и без строк только с комментарием. */
  lines: number;
}

export interface SourceClass {
  name: string;
  line: number;
  /** Методы вне `private`; конструктор не считается. */
  methods: number;
}

export interface ParsedSource {
  imports: SourceImport[];
  functions: SourceFunction[];
  classes: SourceClass[];
  /** Классы, созданные через `new`. */
  created: { name: string; line: number }[];
  /** Сколько раз встречается `process.env`. */
  processEnv: number;
  /** В файле только объявления `export … from`. */
  onlyReexports: boolean;
  codeLines: number;
}

// Узлы oxc — обычные объекты ESTree; типизировать их целиком нет смысла.
type Node = Record<string, any>;

interface Comment {
  start: number;
  end: number;
}

function parse(file: string, text: string): { program: Node; comments: Comment[] } {
  const result = parseSync(file, text);
  const fatal = result.errors.find((error) => error.severity === 'Error');
  if (fatal) throw new Error(`${file}: ${fatal.message}`);
  return { program: result.program as unknown as Node, comments: result.comments };
}

function maskComments(text: string, comments: Comment[]): string {
  let masked = text;
  for (const comment of comments) {
    const blank = text.slice(comment.start, comment.end).replace(/[^\n]/g, ' ');
    masked = masked.slice(0, comment.start) + blank + masked.slice(comment.end);
  }
  return masked;
}

/** Число строк кода: пустые строки и строки только с комментарием не входят. */
export function codeLines(text: string, file = 'file.ts'): number {
  const { comments } = parse(file, text);
  return maskComments(text, comments)
    .split('\n')
    .filter((line) => line.trim() !== '').length;
}

function keyName(key: Node | undefined): string | undefined {
  if (!key) return undefined;
  if (key.type === 'Identifier' || key.type === 'PrivateIdentifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return undefined;
}

const functionTypes = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

export function parseText(file: string, text: string): ParsedSource {
  const { program, comments } = parse(file, text);
  const masked = maskComments(text, comments);
  const lines = masked.split('\n');
  // codePrefix[n] — число строк кода среди первых n строк файла.
  const codePrefix: number[] = [0];
  for (const line of lines) {
    codePrefix.push((codePrefix[codePrefix.length - 1] ?? 0) + (line.trim() === '' ? 0 : 1));
  }
  const lineStarts: number[] = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') lineStarts.push(index + 1);
  }
  const lineOf = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((lineStarts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
  const codeBetween = (start: number, end: number): number => {
    const first = lineOf(start);
    const last = lineOf(Math.max(start, end - 1));
    return (codePrefix[last] ?? 0) - (codePrefix[first - 1] ?? 0);
  };

  const parsed: ParsedSource = {
    imports: [],
    functions: [],
    classes: [],
    created: [],
    processEnv: 0,
    onlyReexports: true,
    codeLines: codePrefix[codePrefix.length - 1] ?? 0,
  };

  const addImport = (
    node: Node,
    source: string,
    typeOnly: boolean,
    extra: { dynamic?: boolean; reexport?: boolean },
  ): void => {
    parsed.imports.push({
      specifier: source,
      typeOnly,
      dynamic: extra.dynamic ?? false,
      reexport: extra.reexport ?? false,
      line: lineOf(node.start),
    });
  };

  const visit = (node: Node, hint: string | undefined): void => {
    switch (node.type) {
      case 'ImportDeclaration': {
        const specifiers: Node[] = node.specifiers ?? [];
        const typeOnly =
          node.importKind === 'type' ||
          (specifiers.length > 0 && specifiers.every((item) => item.importKind === 'type'));
        addImport(node, node.source.value, typeOnly, {});
        break;
      }
      case 'ExportAllDeclaration':
        addImport(node, node.source.value, node.exportKind === 'type', { reexport: true });
        break;
      case 'ExportNamedDeclaration':
        if (node.source) {
          const specifiers: Node[] = node.specifiers ?? [];
          const typeOnly =
            node.exportKind === 'type' ||
            (specifiers.length > 0 && specifiers.every((item) => item.exportKind === 'type'));
          addImport(node, node.source.value, typeOnly, { reexport: true });
        }
        break;
      case 'ImportExpression':
        if (node.source?.type === 'Literal' && typeof node.source.value === 'string') {
          addImport(node, node.source.value, false, { dynamic: true });
        }
        break;
      case 'TSImportType': {
        const value = node.argument?.literal?.value ?? node.source?.value;
        if (typeof value === 'string') addImport(node, value, true, {});
        break;
      }
      case 'NewExpression':
        if (node.callee?.type === 'Identifier') {
          parsed.created.push({ name: node.callee.name, line: lineOf(node.start) });
        }
        break;
      case 'MemberExpression':
        if (
          node.object?.type === 'Identifier' &&
          node.object.name === 'process' &&
          !node.computed &&
          node.property?.name === 'env'
        ) {
          parsed.processEnv += 1;
        }
        break;
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const members: Node[] = node.body?.body ?? [];
        const methods = members.filter(
          (member) =>
            member.type === 'MethodDefinition' &&
            member.kind !== 'constructor' &&
            member.accessibility !== 'private' &&
            member.key?.type !== 'PrivateIdentifier',
        ).length;
        parsed.classes.push({
          name: node.id?.name ?? hint ?? '<anonymous>',
          line: lineOf(node.start),
          methods,
        });
        break;
      }
      default:
        break;
    }

    if (functionTypes.has(node.type)) {
      parsed.functions.push({
        name: node.id?.name ?? hint ?? '<anonymous>',
        line: lineOf(node.start),
        lines: codeBetween(node.start, node.end),
      });
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || value === null || typeof value !== 'object') continue;
      const children: unknown[] = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (
          child === null ||
          typeof child !== 'object' ||
          typeof (child as Node).type !== 'string'
        ) {
          continue;
        }
        let childHint: string | undefined;
        if (node.type === 'VariableDeclarator' && key === 'init') childHint = keyName(node.id);
        else if (
          (node.type === 'MethodDefinition' ||
            node.type === 'Property' ||
            node.type === 'PropertyDefinition') &&
          key === 'value'
        ) {
          childHint = keyName(node.key);
        } else if (node.type === 'ExportDefaultDeclaration') childHint = 'default';
        visit(child as Node, childHint);
      }
    }
  };

  const body: Node[] = program.body ?? [];
  parsed.onlyReexports = body.every(
    (statement) =>
      statement.type === 'ExportAllDeclaration' ||
      (statement.type === 'ExportNamedDeclaration' && statement.source && !statement.declaration),
  );
  visit(program, undefined);
  return parsed;
}

export function parseSource(file: string): ParsedSource {
  return parseText(file, readFileSync(file, 'utf8'));
}
