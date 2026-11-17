import { basename, join } from 'node:path';
import { execPath } from 'node:process';
import { pathToFileURL } from 'node:url';
import { codeRoot } from '../../../../platform/build/index.ts';
import type { GeneratedFile } from '../../types/index.ts';
import type { ToolPolicy } from './decision.ts';

function quote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export interface GateSpec {
  /** Where the gate lives (inside the private state of the conversation). */
  directory: string;
  policy: ToolPolicy;
  /** The adapter, relative to `clients/`: `cline/gate`; it exports `decide(policy, request)`. */
  module: string;
  /** What the script prints when anything fails: the refusal in the format of the CLI. */
  failure: unknown;
}

export interface Gate {
  /** The shell command a CLI runs for every tool call. */
  command: string;
  files: GeneratedFile[];
}

/**
 * A small generated stdin script around the evaluator of the shipped code tree. A policy that is
 * missing, malformed or a script that throws prints the refusal: the gate is closed by default.
 */
export function gateFiles(spec: GateSpec): Gate {
  const script = join(spec.directory, 'gate.mjs');
  const policyFile = join(spec.directory, 'policy.json');
  const root = codeRoot();
  const extension = basename(root) === 'src' ? 'ts' : 'js';
  const module = pathToFileURL(
    join(root, 'feature', 'agents', 'clients', `${spec.module}.${extension}`),
  ).href;
  const source = [
    `import { readFileSync } from 'node:fs';`,
    `let result = ${JSON.stringify(spec.failure)};`,
    `try {`,
    `  const { decide } = await import(${JSON.stringify(module)});`,
    `  const policy = JSON.parse(readFileSync(${JSON.stringify(policyFile)}, 'utf8'));`,
    `  const request = JSON.parse(readFileSync(0, 'utf8'));`,
    `  result = decide(policy, request);`,
    `} catch {}`,
    `process.stdout.write(JSON.stringify(result));`,
  ].join('\n');
  return {
    command: `${quote(execPath)} ${quote(script)}`,
    files: [
      { path: policyFile, content: JSON.stringify(spec.policy) },
      { path: script, content: source },
    ],
  };
}
