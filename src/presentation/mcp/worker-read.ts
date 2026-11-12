import { z } from 'zod';

import { WORKER_TOOLS } from '../../feature/agents/types/index.ts';
import { formatGroup, formatRun } from '../format/index.ts';
import type { GroupView, RunView } from '../ipc/contract/index.ts';
import { attempt } from './tools.ts';
import type { WorkerKit } from './worker-tools.ts';

interface WorkerRunShow {
  run: RunView;
  tasks: { slug: string; title: string; task: string }[];
  group: GroupView | null;
}

/** The overview of a run and the full task of each of its groups. */
function runText(view: WorkerRunShow): string {
  const tasks = view.tasks.map((group) => `- ${group.slug} (${group.title}): ${group.task}`);
  const text = formatRun(view.run, Date.now());
  return tasks.length === 0 ? text : `${text}\n\n## Tasks of groups\n${tasks.join('\n')}`;
}

export function registerRunShow(kit: WorkerKit): void {
  const { options, server } = kit;
  server.registerTool(
    WORKER_TOOLS.runShow,
    {
      title: 'Read a run of this repository',
      description:
        'Read another run (or this one) of the repository this run belongs to, without changing it: its groups, questions, accepted answers and the task of every group; with a group, every attempt with summaries and feedback and the tail of its latest log. Use it for links like http://127.0.0.1:7341/#runs/<id> and task numbers like #333 instead of asking a person for their content.',
      inputSchema: {
        run: z
          .string()
          .trim()
          .min(1)
          .describe('Run id, task number (333 or #333) or a panel link with #runs/<id>[/<group>]'),
        group: z
          .string()
          .min(1)
          .optional()
          .describe('Group slug for its details; defaults to the group of the link'),
        tail_lines: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Lines of the latest log of the group, 40 by default'),
      },
    },
    ({ run, group, tail_lines }) =>
      attempt(async () => {
        const view = (await options.send('worker_run_show', {
          token: options.token,
          run,
          ...(group !== undefined ? { group } : {}),
          ...(tail_lines !== undefined ? { tailLines: tail_lines } : {}),
        })) as WorkerRunShow;
        return view.group ? formatGroup(view.group) : runText(view);
      }),
  );
}
