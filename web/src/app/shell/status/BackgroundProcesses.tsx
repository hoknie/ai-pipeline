import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { groupProcessesByTask, type BackgroundProcesses as Polled } from './backgroundProcesses.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { notifyError, notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { BackgroundProcessView } from '../../../shared/api/types.ts';
import { ProcessRow, TaskRow } from './ProcessRows.tsx';

/** Terminating a process (after a confirmation) and copying a command. */
function useProcessActions(api: Api, polled: Polled) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [killing, setKilling] = useState<ReadonlySet<number>>(new Set());
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
  return { killing, kill, copy };
}

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
  const { t } = useTranslation();
  const rows = polled.processes ?? [];
  const { killing, kill, copy } = useProcessActions(api, polled);

  if (polled.error !== null && polled.processes === null) {
    return <p className="text-destructive">{polled.error}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-muted-foreground">{t('statusBar.noProcesses')}</p>;
  }
  const tasks = groupProcessesByTask(rows);
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
      {tasks.map((task) => (
        <tbody key={task.key}>
          <TaskRow task={task} onOpenGroup={onOpenGroup} />
          {task.processes.map((process) => (
            <ProcessRow
              key={process.pid}
              process={process}
              killing={killing.has(process.pid)}
              onKill={() => void kill(process)}
              onCopy={(text) => void copy(text)}
            />
          ))}
        </tbody>
      ))}
    </table>
  );
}
