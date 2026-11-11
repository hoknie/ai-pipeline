import { CircleStop, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { BackgroundProcessView } from '../../../shared/api/types.ts';
import { formatCpu, formatMemory, formatUptime } from '../../../shared/lib/format.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/feedback/tooltip.tsx';
import { FILE_PATH_CLASS } from '../../../shared/ui/layout/FilePath.tsx';
import type { groupProcessesByTask } from './backgroundProcesses.ts';

const line = 'border-b group-last/row:border-0';
const numeric = `${line} px-2 py-1.5 text-right align-middle whitespace-nowrap tabular-nums`;

type Task = ReturnType<typeof groupProcessesByTask>[number];

/** The row over the processes of one task: a link to the group that started them. */
export function TaskRow({
  task,
  onOpenGroup,
}: {
  task: Task;
  onOpenGroup: (target: { runId: string; group: string; step: string | null }) => void;
}) {
  const { t } = useTranslation();
  const { owner } = task;
  const last = task.processes[task.processes.length - 1]!;
  return (
    <tr className="bg-muted/40">
      <th scope="rowgroup" colSpan={6} className="border-b px-2 py-1.5 text-left font-medium">
        {owner.group !== null ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto max-w-full justify-start p-0 text-xs font-medium"
            onClick={() =>
              onOpenGroup({ runId: owner.runId, group: owner.group!, step: last.owner.step })
            }
          >
            <span className="truncate">
              {t('statusBar.owner', {
                group: owner.groupTitle ?? owner.group,
                run: owner.runTitle,
              })}
            </span>
          </Button>
        ) : (
          <span className="block truncate text-xs">{owner.runTitle}</span>
        )}
      </th>
    </tr>
  );
}

function CommandCell({ command, onCopy }: { command: string; onCopy: (text: string) => void }) {
  const { t } = useTranslation();
  return (
    <td className={`${line} min-w-0 px-2 py-1.5 align-middle`}>
      <div className="flex min-w-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <code tabIndex={0} className={`${FILE_PATH_CLASS} block min-w-0 truncate`}>
              {command}
            </code>
          </TooltipTrigger>
          <TooltipContent className="max-w-[min(40rem,90vw)] font-mono break-all">
            {command}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label={t('statusBar.copyCommand')}
              onClick={() => onCopy(command)}
            >
              <Copy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('statusBar.copyCommand')}</TooltipContent>
        </Tooltip>
      </div>
    </td>
  );
}

/** One process: pid, command, uptime, load and the button that terminates it. */
export function ProcessRow({
  process,
  killing,
  onKill,
  onCopy,
}: {
  process: BackgroundProcessView;
  killing: boolean;
  onKill: () => void;
  onCopy: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const command = process.command === '' ? process.name : process.command;
  return (
    <tr className="group/row hover:bg-muted/50">
      <td className={numeric}>{process.pid}</td>
      <CommandCell command={command} onCopy={onCopy} />
      <td className={numeric}>{formatUptime(process.uptimeSeconds, t)}</td>
      <td className={numeric}>{formatCpu(process.cpuPercent, i18n.language)}</td>
      <td className={numeric}>{formatMemory(process.memoryBytes, t, i18n.language)}</td>
      <td className={`${line} px-2 py-1.5 text-right align-middle`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive hover:text-destructive"
              disabled={killing}
              aria-label={t('statusBar.killLabel', { name: process.name, pid: process.pid })}
              onClick={onKill}
            >
              <CircleStop className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('statusBar.kill')}</TooltipContent>
        </Tooltip>
      </td>
    </tr>
  );
}
