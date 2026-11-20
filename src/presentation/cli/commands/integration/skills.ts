import type { Command } from 'commander';

import { formatRegistrySkills, type Style } from '../../../format/index.ts';
import type { RegistrySkillView } from '../../../ipc/contract/index.ts';
import { call } from '../../context.ts';

/** What `aip integration skills` takes from the group of commands it joins. */
interface SkillsKit {
  examples: (lines: string[]) => string;
  context: () => Parameters<typeof call>[0];
  output: (json: boolean | undefined, text: string, data: unknown) => void;
  activeStyle: Style;
}

/** `aip integration skills <id> [--query]`: the skills of a service registry connection. */
export function addSkillsCommand(root: Command, kit: SkillsKit): void {
  const { examples, context, output, activeStyle } = kit;
  root
    .command('skills')
    .description('List the skills of a service registry connection with their versions')
    .argument('<id>', 'connection id of a service registry')
    .option('--query <text>', 'search by words')
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip integration skills c1a2b3c4d5e6',
        'aip integration skills c1a2b3c4d5e6 --query go',
      ]),
    )
    .action(async (id: string, options: { query?: string; json?: boolean }) => {
      const skills = (await call(context(), 'integration_skills', {
        id,
        ...(options.query === undefined ? {} : { query: options.query }),
      })) as RegistrySkillView[];
      output(options.json, formatRegistrySkills(skills, activeStyle), skills);
    });
}
