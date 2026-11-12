import type {
  ArtifactView,
  FileDiffView,
  GroupSpecView,
  GroupView,
  RunView,
  Transcript,
} from './types.ts';
import { ApiError, call, enc } from './http.ts';

/** How many finished runs one page of the run list loads. */
const FINISHED_PAGE = 50;

export interface RunsApi {
  runs(): Promise<RunView[]>;
  /**
   * A page of finished runs after the cursor `before` (none: the newest), of one repository (its
   * absolute path) or of all; `next` is null at the end.
   */
  finishedRuns(
    before?: string,
    repository?: string,
  ): Promise<{ runs: RunView[]; next: string | null }>;
  /** One run by id, also one the list no longer carries; 404 when the daemon does not know it. */
  run(runId: string): Promise<RunView>;
  group(runId: string, group: string): Promise<GroupView>;
  groupSpec(runId: string, group: string): Promise<GroupSpecView | null>;
  transcript(runId: string, group: string, seq: number, after: number): Promise<Transcript>;
  /** Diff of one changed file of a group with a few lines of context. */
  fileDiff(runId: string, group: string, path: string): Promise<FileDiffView>;
  /** Artifacts the specialists published for a group, newest first. */
  groupArtifacts(runId: string, group: string): Promise<ArtifactView[]>;
  /** Address of an artifact: the download, or with `inline` the text for a preview. */
  artifactUrl(runId: string, group: string, id: string, inline?: boolean): string;
  /** The text of a `.md` or `.log` artifact. */
  artifactText(runId: string, group: string, id: string): Promise<string>;
  /** The patch of the merged groups of a run, for `git apply`. */
  runPatch(runId: string): Promise<{ blob: Blob; fileName: string }>;
}

export function runsApi(): RunsApi {
  const api: RunsApi = {
    runs: () => call('/api/runs'),
    finishedRuns: (before, repository) =>
      call(
        `/api/finished-runs?limit=${FINISHED_PAGE}${before ? `&before=${enc(before)}` : ''}${
          repository ? `&repository=${enc(repository)}` : ''
        }`,
      ),
    run: (runId) => call(`/api/runs/${enc(runId)}`),
    group: (runId, group) => call(`/api/runs/${enc(runId)}/groups/${enc(group)}?tail=200`),
    groupSpec: (runId, group) => call(`/api/runs/${enc(runId)}/groups/${enc(group)}/spec`),
    transcript: (runId, group, seq, after) =>
      call(`/api/runs/${enc(runId)}/groups/${enc(group)}/transcript?seq=${seq}&after=${after}`),
    fileDiff: (runId, group, path) =>
      call(`/api/runs/${enc(runId)}/groups/${enc(group)}/diff?path=${enc(path)}`),
    groupArtifacts: async (runId, group) =>
      (
        await call<{ artifacts: ArtifactView[] }>(
          `/api/runs/${enc(runId)}/groups/${enc(group)}/artifacts`,
        )
      ).artifacts,
    artifactUrl: (runId, group, id, inline = false) =>
      `/api/runs/${enc(runId)}/groups/${enc(group)}/artifacts/${enc(id)}${inline ? '?inline=1' : ''}`,
    artifactText: async (runId, group, id) => {
      const response = await fetch(api.artifactUrl(runId, group, id, true), {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(response.status, body.error ?? response.statusText);
      }
      return response.text();
    },
    runPatch: async (runId) => {
      const response = await fetch(`/api/runs/${enc(runId)}/patch`, { credentials: 'same-origin' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(response.status, body.error ?? response.statusText);
      }
      const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '');
      return { blob: await response.blob(), fileName: name?.[1] ?? `${runId}.patch` };
    },
  };
  return api;
}
