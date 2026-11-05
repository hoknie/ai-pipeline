import { CircleStop, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import {
  groupProcessesByTask,
  type BackgroundProcesses as Polled,
} from '../../backgroundProcesses.ts';
import { useConfirm } from '../../confirm.tsx';
import { formatCpu, formatMemory, formatUptime } from '../../format.ts';
import { notifyError, notifySuccess } from '../../notify.ts';
import type { BackgroundProcessView } from '../../types.ts';
import { Button } from '../../ui/button.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.tsx';
import { FILE_PATH_CLASS } from '../FilePath.tsx';

/** Table of the processes agents started, with a button that terminates each. */
export function BackgroundProcesses({
  api,
  polled,
  onOpenGroup,
}: {
  api: Api;
  polled: Polled;
  onOpenGroup: (target: { runId: string; group: string; step: string | null }) => void;
}) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [killing, setKilling] = useState<ReadonlySet<number>>(new Set());
  const rows = polled.processes ?? [];

  const kill = async (process: BackgroundProcessView) => {
    const yes = await confirm({
      title: t('statusBar.killTitle', { name: process.name, pid: process.pid }),
      description: t('statusBar.killDescription'),
      confirmLabel: t('statusBar.kill'),
      destructive: true,
    });
    if (!yes) return;
    setKilling((current) => new Set(current).add(process.pid));
    try {
      await api.killProcess(process.pid);
      await polled.refresh();
    } catch (error) {
      notifyError(error);
    } finally {
      setKilling((current) => {
        const next = new Set(current);
        next.delete(process.pid);
        return next;
      });
    }
  };

  const copy = async (text: string) => {
    try {
      if (!navigator.clipboard) throw new Error(t('statusBar.copyFailed'));
      await navigator.clipboard.writeText(text);
      notifySuccess(t('statusBar.copied'));
    } catch {
      notifyError(t('statusBar.copyFailed'));
    }
  };

  if (polled.error !== null && polled.processes === null) {
    return <p className="text-destructive">{polled.error}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-muted-foreground">{t('statusBar.noProcesses')}</p>;
  }
  const tasks = groupProcessesByTask(rows);
  const numeric = 'px-2 py-1.5 text-right align-middle whitespace-nowrap tabular-nums';
  const head = 'bg-card px-2 py-1.5 font-medium';
  return (
    <table className="w-full table-fixed text-left">
      <colgroup>
        <col className="w-16" />
        <col />
        <col className="w-24" />
        <col className="w-20" />
        <col className="w-24" />
        <col className="w-20" />
      </colgroup>
      <thead className="sticky top-0 z-10 border-b text-muted-foreground">
        <tr>
          <th className={`${head} text-right`}>{t('statusBar.pid')}</th>
          <th className={head}>{t('statusBar.command')}</th>
          <th className={`${head} text-right`}>{t('statusBar.uptime')}</th>
          <th className={`${head} text-right`}>{t('statusBar.cpu')}</th>
          <th className={`${head} text-right`}>{t('statusBar.memory')}</th>
          <th className={head}>
            <span className="sr-only">{t('statusBar.kill')}</span>
          </th>
        </tr>
      </thead>
      {tasks.map((task) => {
        const { owner } = task;
        const last = task.processes[task.processes.length - 1]!;
        return (
          <tbody key={task.key}>
            <tr className="border-b bg-muted/40">
              <th scope="rowgroup" colSpan={6} className="px-2 py-1.5 text-left font-medium">
                {owner.group !== null ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto max-w-full justify-start p-0 text-xs font-medium"
                    onClick={() =>
                      onOpenGroup({
                        runId: owner.runId,
                        group: owner.group!,
                        step: last.owner.step,
                      })
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
            {task.processes.map((process) => {
              const command = process.command === '' ? process.name : process.command;
              return (
                <tr key={process.pid} className="border-b last:border-0 hover:bg-muted/50">
                  <td className={numeric}>{process.pid}</td>
                  <td className="min-w-0 px-2 py-1.5 align-middle">
                    <div className="flex min-w-0 items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <code
                            tabIndex={0}
                            className={`${FILE_PATH_CLASS} block min-w-0 truncate`}
                          >
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
                            onClick={() => void copy(command)}
                          >
                            <Copy className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('statusBar.copyCommand')}</TooltipContent>
                      </Tooltip>
                    </div>
                  </td>
                  <td className={numeric}>{formatUptime(process.uptimeSeconds, t)}</td>
                  <td className={numeric}>{formatCpu(process.cpuPercent, i18n.language)}</td>
                  <td className={numeric}>{formatMemory(process.memoryBytes, t, i18n.language)}</td>
                  <td className="px-2 py-1.5 text-right align-middle">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          disabled={killing.has(process.pid)}
                          aria-label={t('statusBar.killLabel', {
                            name: process.name,
                            pid: process.pid,
                          })}
                          onClick={() => void kill(process)}
                        >
                          <CircleStop className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('statusBar.kill')}</TooltipContent>
                    </Tooltip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        );
      })}
    </table>
  );
}
