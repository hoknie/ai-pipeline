import { useTranslation } from 'react-i18next';

import { notifySuccess } from '../../../../shared/lib/browser/notify.ts';
import { Empty } from '../../../../shared/ui/feedback/empty.tsx';
import { Skeleton } from '../../../../shared/ui/feedback/skeleton.tsx';
import { Markdown } from '../../../../shared/ui/layout/Markdown.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../shared/ui/layout/tabs.tsx';
import { ArtifactsTab } from '../../files/ArtifactsTab.tsx';
import { DiffStat } from '../../files/DiffStat.tsx';
import { FileTree } from '../../files/FileTree.tsx';
import { AttemptTimeline } from '../AttemptTimeline.tsx';
import type { GroupCtx } from './useGroupCtx.ts';

function TabTriggers({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { row, view, caps } = ctx;
  const { spec, progress } = ctx.tabs;
  return (
    <TabsList aria-label={t('runs.group.tabs')}>
      <TabsTrigger value="log">{t('runs.group.log')}</TabsTrigger>
      {caps.changes ? (
        <TabsTrigger value="changes">
          {t('runs.group.changes')}
          {view?.diff ? ` · ${view.diff.files.length}` : ''}
        </TabsTrigger>
      ) : null}
      <TabsTrigger value="task">{t('runs.group.task')}</TabsTrigger>
      {spec?.design != null ? (
        <TabsTrigger value="design">{t('runs.group.design')}</TabsTrigger>
      ) : null}
      {spec?.tasks != null ? (
        <TabsTrigger value="tasks">
          {t('runs.group.tasks')}
          {progress ? ` · ${progress.done}/${progress.total}` : ''}
        </TabsTrigger>
      ) : null}
      <TabsTrigger
        value="artifacts"
        disabled={row.artifacts === 0}
        title={row.artifacts === 0 ? t('runs.group.artifactsEmpty') : undefined}
      >
        {t('runs.group.artifacts')}
        {row.artifacts > 0 ? ` · ${row.artifacts}` : ''}
      </TabsTrigger>
    </TabsList>
  );
}

function LogTab({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { api, runId, row, view, caps } = ctx;
  if (!view) return null;
  const lastSeq = view.attempts.at(-1)?.seq ?? null;
  const openSeq =
    (ctx.openStep
      ? view.attempts.findLast((attempt) => attempt.stepId === ctx.openStep)?.seq
      : null) ?? lastSeq;
  return (
    <TabsContent value="log" className="flex flex-col gap-3">
      <AttemptTimeline
        api={api}
        runId={runId}
        group={row.slug}
        attempts={view.attempts}
        openSeq={openSeq}
        lastSeq={lastSeq}
        rawLog={view.log ? view.log.lines : null}
        onlyReplies={ctx.onlyReplies}
        showJson={false}
        onMessage={() => ctx.setMessaging(lastSeq)}
        retryable={caps.retry && (row.status === 'failed' || row.status === 'cancelled')}
        onRetry={() =>
          void ctx.act(
            () => api.retry(runId, row.slug),
            () => notifySuccess(t('runs.header.retryStarted')),
          )
        }
      />
    </TabsContent>
  );
}

function ChangesTab({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { api, runId, row, view } = ctx;
  if (!view) return null;
  return (
    <TabsContent value="changes">
      {view.diff && view.diff.files.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-muted-foreground">
            <DiffStat
              diff={{
                files: view.diff.files.length,
                added: view.diff.added,
                removed: view.diff.removed,
              }}
            />
          </div>
          <FileTree
            files={view.diff.files}
            diff={{ api, runId, group: row.slug, revision: view.diff.revision }}
          />
        </div>
      ) : (
        <Empty title={t('runs.group.noChanges')}>{t('runs.group.noChangesText')}</Empty>
      )}
    </TabsContent>
  );
}

function TextTab({
  value,
  label,
  change,
  text,
}: {
  value: string;
  label: string;
  change?: string;
  text: string;
}) {
  const { t } = useTranslation();
  return (
    <TabsContent value={value}>
      <section aria-label={label} className="rounded-md border bg-card p-4 text-card-foreground">
        {change !== undefined ? (
          <p className="mb-2 text-xs text-muted-foreground">
            {t('runs.group.specChange', { name: change })}
          </p>
        ) : null}
        <Markdown text={text} />
      </section>
    </TabsContent>
  );
}

/** The tabs of the group: the log, the changes, the task, the spec and the artifacts. */
export function GroupTabsView({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { api, runId, row, view, caps } = ctx;
  const { spec } = ctx.tabs;
  if (view === null) {
    return (
      <div role="status" aria-label={t('runs.group.loading')} className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  return (
    <Tabs value={ctx.tabs.tab} onValueChange={ctx.tabs.setTab}>
      <TabTriggers ctx={ctx} />
      <LogTab ctx={ctx} />
      {caps.changes ? <ChangesTab ctx={ctx} /> : null}
      <TextTab value="task" label={t('runs.group.task')} text={view.task} />
      {spec?.design != null ? (
        <TextTab
          value="design"
          label={t('runs.group.design')}
          change={spec.change}
          text={spec.design}
        />
      ) : null}
      {spec?.tasks != null ? (
        <TextTab
          value="tasks"
          label={t('runs.group.tasks')}
          change={spec.change}
          text={spec.tasks}
        />
      ) : null}
      {row.artifacts > 0 ? (
        <TabsContent value="artifacts">
          <ArtifactsTab
            api={api}
            runId={runId}
            group={row.slug}
            count={row.artifacts}
            revision={row.artifactsRevision}
            onError={ctx.onError}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
