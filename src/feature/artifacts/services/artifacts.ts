import { randomUUID } from 'node:crypto';

import { rejected } from '../../../platform/errors/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import { attemptStepLabel, findGroup } from '../../runs/types/index.ts';
import type { ArtifactsPublishPort } from '../ports/index.ts';
import {
  artifactStorageFor,
  type ArtifactRepository,
  type ArtifactStorage,
} from '../repositories/index.ts';
import {
  ARTIFACTS_PER_GROUP,
  artifactPreview,
  artifactTitle,
  type ArtifactContentView,
  type ArtifactView,
} from '../types/index.ts';

import { readArtifactFile } from './files.ts';

export interface ArtifactDependencies {
  artifacts: ArtifactRepository;
  storages: ArtifactStorage[];
  runs: Pick<RunsServices, 'states' | 'reads' | 'effects' | 'engine'>;
  now: () => number;
  publish: ArtifactsPublishPort;
}

/** A file a specialist publishes from its attempt: its content or a path in the worktree. */
export interface ArtifactPublication {
  token: string;
  fileName: string;
  title?: string | undefined;
  content?: string | undefined;
  path?: string | undefined;
}

/** Files the specialists of a run publish, kept in the artifact storage. */
export class ArtifactService {
  private readonly dependencies: ArtifactDependencies;

  constructor(dependencies: ArtifactDependencies) {
    this.dependencies = dependencies;
  }

  /** Removes artifact files of runs the database does not know and files it has no record of. */
  async sweep(): Promise<void> {
    const keep = this.dependencies.artifacts.artifactUris();
    for (const storage of this.dependencies.storages) {
      await storage.sweep(keep).catch(() => undefined);
    }
  }

  /** How many artifacts each group of the run has, and how often its list changed. */
  counts(runId: string): Map<string, { count: number; revision: number }> {
    return this.dependencies.artifacts.artifactCounts(runId);
  }

  list(params: { runId: string; group: string }): ArtifactView[] {
    const { state, group } = this.dependencies.runs.reads.groupOf(params.runId, params.group);
    return this.dependencies.artifacts.artifacts(state.run.id, group.slug).map((record) => {
      const attempt = group.attempts.find((candidate) => candidate.seq === record.seq);
      return {
        id: record.id,
        step: record.step,
        stepName: attempt ? attemptStepLabel(state, group, attempt) : record.step,
        seq: record.seq,
        specialist: record.specialist,
        title: record.title,
        fileName: record.fileName,
        size: record.size,
        createdAt: record.createdAt,
        preview: artifactPreview(record.fileName),
      };
    });
  }

  async content(params: {
    runId: string;
    group: string;
    id: string;
  }): Promise<ArtifactContentView> {
    const { id } = params;
    const { state, group } = this.dependencies.runs.reads.groupOf(params.runId, params.group);
    const record = this.dependencies.artifacts.artifact(state.run.id, id);
    if (!record || record.group !== group.slug) throw rejected(`unknown artifact \`${id}\``);
    const storage = artifactStorageFor(this.dependencies.storages, record.uri);
    const bytes = (await storage?.get(record.uri)) ?? null;
    if (bytes === null) throw rejected(`artifact \`${id}\` is not available`);
    return { fileName: record.fileName, size: bytes.length, base64: bytes.toString('base64') };
  }

  /** `artifact_publish`: a running attempt stores a file; the same name replaces its earlier one. */
  async publish(params: ArtifactPublication): Promise<{ id: string }> {
    const { runs } = this.dependencies;
    const key = runs.effects.attemptFor(params.token);
    if (!key) throw rejected('unknown or expired report token');
    const state = runs.states.get(key.run);
    const group = findGroup(state, key.group);
    const attempt = group?.attempts.find((candidate) => candidate.seq === key.seq);
    if (!group || !attempt || attempt.status !== 'running') {
      throw rejected('unknown or expired report token');
    }
    const bytes =
      params.content !== undefined
        ? Buffer.from(params.content, 'utf8')
        : await readArtifactFile(runs.effects.worktreePath(state, group), params.path ?? '');
    return runs.engine.serial(async () => {
      const id = await this.store(state.run.id, group.slug, attempt, params, bytes);
      this.dependencies.publish.runChanged(state);
      return { id };
    });
  }

  private async store(
    runId: string,
    group: string,
    attempt: { seq: number; stepId: string; specialist: string },
    params: ArtifactPublication,
    bytes: Buffer,
  ): Promise<string> {
    const { artifacts, storages, now } = this.dependencies;
    const fileName = params.fileName;
    const existing = artifacts.findArtifact(runId, group, attempt.seq, fileName);
    if (!existing && artifacts.artifactCount(runId, group) >= ARTIFACTS_PER_GROUP) {
      throw rejected(`a group may have at most ${ARTIFACTS_PER_GROUP} artifacts`);
    }
    const id = existing?.id ?? randomUUID();
    const uri = await storages[0]!.put(runId, id, bytes);
    const { artifact, previousUri } = artifacts.addArtifact({
      id,
      runId,
      group,
      step: attempt.stepId,
      seq: attempt.seq,
      specialist: attempt.specialist,
      title: params.title ?? artifactTitle(fileName),
      fileName,
      size: bytes.length,
      uri,
      createdAt: now(),
    });
    if (previousUri !== null && previousUri !== uri) {
      await artifactStorageFor(storages, previousUri)
        ?.remove(previousUri)
        .catch(() => undefined);
    }
    return artifact.id;
  }
}
