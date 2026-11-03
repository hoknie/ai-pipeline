import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import type { BackgroundProcesses as Polled } from '../../backgroundProcesses.ts';
import { useConfirm } from '../../confirm.tsx';
import { formatCpu, formatMemory, formatUptime } from '../../format.ts';
import { notifyError } from '../../notify.ts';
import type { BackgroundProcessView } from '../../types.ts';
import { Button } from '../../ui/button.tsx';

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

  if (polled.error !== null && polled.processes === null) {
    return <p className="text-destructive">{polled.error}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-muted-foreground">{t('statusBar.noProcesses')}</p>;
  }
  return (
    <table className="w-full text-left">
      <thead className="text-muted-foreground">
        <tr>
          <th className="pr-3 font-medium">{t('statusBar.pid')}</th>
          <th className="pr-3 font-medium">{t('statusBar.name')}</th>
          <th className="pr-3 font-medium">{t('statusBar.uptime')}</th>
          <th className="pr-3 font-medium">{t('statusBar.cpu')}</th>
          <th className="pr-3 font-medium">{t('statusBar.memory')}</th>
          <th className="font-medium">
            <span className="sr-only">{t('statusBar.kill')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((process) => (
          <tr key={process.pid} className="align-top">
            <td className="pr-3 tabular-nums">{process.pid}</td>
            <td className="min-w-0 pr-3">
              <div className="font-medium" title={process.command}>
                {process.name}
              </div>
              {process.owner.group !== null ? (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs whitespace-normal"
                  onClick={() =>
                    onOpenGroup({
                      runId: process.owner.runId,
                      group: process.owner.group!,
                      step: process.owner.step,
                    })
                  }
                >
                  {t('statusBar.owner', {
                    group: process.owner.groupTitle ?? process.owner.group,
                    run: process.owner.runTitle,
                  })}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{process.owner.runTitle}</span>
              )}
            </td>
            <td className="pr-3 whitespace-nowrap tabular-nums">
              {formatUptime(process.uptimeSeconds, t)}
            </td>
            <td className="pr-3 whitespace-nowrap tabular-nums">
              {formatCpu(process.cpuPercent, i18n.language)}
            </td>
            <td className="pr-3 whitespace-nowrap tabular-nums">
              {formatMemory(process.memoryBytes, t, i18n.language)}
            </td>
            <td>
              <Button
                variant="destructive"
                size="sm"
                disabled={killing.has(process.pid)}
                aria-label={t('statusBar.killLabel', { name: process.name, pid: process.pid })}
                onClick={() => void kill(process)}
              >
                {t('statusBar.kill')}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
