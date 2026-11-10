import type { ObserverHistoryView } from '../contract/responses/observer-history.ts';

export function observerHistoryView(value: ObserverHistoryView): ObserverHistoryView {
  return {
    items: value.items.map(
      ({
        id,
        runId,
        runNumber,
        runTitle,
        repository,
        attemptSeq,
        runtime,
        model,
        startedAt,
        finishedAt,
        status,
        verdict,
        result,
        failureKind,
        usage,
      }) => ({
        id,
        runId,
        runNumber,
        runTitle,
        repository,
        attemptSeq,
        runtime,
        model,
        startedAt,
        finishedAt,
        status,
        verdict,
        result,
        failureKind,
        usage,
      }),
    ),
    nextCursor: value.nextCursor,
    limit: value.limit,
    projects: value.projects,
    asOf: value.asOf,
  };
}
