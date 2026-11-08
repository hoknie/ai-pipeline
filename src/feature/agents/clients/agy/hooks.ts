import { basename, join } from 'node:path';
import { execPath } from 'node:process';
import { pathToFileURL } from 'node:url';
import { codeRoot } from '../../../../platform/build/index.ts';
import type { GeneratedFile } from '../../types/index.ts';
import type { AgyPolicy } from './guard.ts';

function quote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/** Small generated stdin entry; the policy evaluator itself stays in the shipped code tree. */
export function agyHookFiles(directory: string, policy: AgyPolicy): GeneratedFile[] {
  const script = join(directory, 'permission-hook.mjs');
  const root = codeRoot();
  const extension = basename(root) === 'src' ? 'ts' : 'js';
  const module = pathToFileURL(
    join(root, 'feature', 'agents', 'clients', 'agy', `guard.${extension}`),
  ).href;
  const policyFile = join(directory, 'policy.json');
  const source = [
    `import { readFileSync } from 'node:fs';`,
    `let result = { decision: 'deny', reason: 'aip: permission hook failed' };`,
    `try {`,
    `  const { agyToolDecision } = await import(${JSON.stringify(module)});`,
    `  const policy = JSON.parse(readFileSync(${JSON.stringify(policyFile)}, 'utf8'));`,
    `  const request = JSON.parse(readFileSync(0, 'utf8'));`,
    `  result = agyToolDecision(policy, request);`,
    `} catch {}`,
    `process.stdout.write(JSON.stringify(result));`,
  ].join('\n');
  return [
    { path: policyFile, content: JSON.stringify(policy) },
    { path: script, content: source },
    {
      path: join(directory, '.agents', 'hooks.json'),
      content: JSON.stringify({
        'aip-permissions': {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [
                { type: 'command', command: `${quote(execPath)} ${quote(script)}`, timeout: 10 },
              ],
            },
          ],
        },
      }),
    },
  ];
}
