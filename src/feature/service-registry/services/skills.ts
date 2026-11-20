import { invalid } from '../../../platform/errors/index.ts';
import type { Connection } from '../../integrations/types/index.ts';
import type { IntegrationsServices } from '../../integrations/services/index.ts';
import {
  maxSatisfying,
  parseRegistrySkill,
  parseVersion,
  registrySkillText,
  sortVersionsDescending,
  type RegistrySkillRef,
} from '../../swarm-config/types/index.ts';
import type { RegistryTransportPort } from '../ports/index.ts';
import {
  RegistryFailure,
  SERVICE_REGISTRY_KIND,
  SKILL_TIMEOUT_MS,
  registryBase,
  type McpEndpoint,
  type PinnedRegistrySkill,
  type RegistrySkill,
  type SkillReason,
} from '../types/index.ts';

import { SkillArchiveError, SkillCache } from './skill-cache.ts';
import { SkillSource } from './skill-source.ts';

export interface SkillsDependencies {
  transport: RegistryTransportPort;
  proxyFor: (url: string) => string | null;
  integrations: () => Pick<IntegrationsServices, 'access' | 'secrets'>;
  /** `<state>/service-registry/skills`. */
  cacheDirectory: string;
  now: () => number;
}

/** What `pin` found: the versions fixed and, per reference that failed, the warning text. */
export interface PinResult {
  pinned: PinnedRegistrySkill[];
  problems: string[];
}

/** A failure of one skill with the reason that goes into the warning. */
class Unavailable extends Error {}

function reasonOf(error: unknown): SkillReason {
  if (error instanceof Unavailable) return error.message;
  if (error instanceof RegistryFailure) return error.code;
  if (error instanceof SkillArchiveError) return 'invalid archive';
  return 'unreachable';
}

/**
 * The skills of a registry for the specialists: which connection serves a project, which version
 * a range selects, the download into the cache and the copy for one attempt.
 */
export class SkillService {
  private readonly dependencies: SkillsDependencies;
  private readonly source: SkillSource;
  readonly cache: SkillCache;

  constructor(dependencies: SkillsDependencies) {
    this.dependencies = dependencies;
    this.source = new SkillSource(dependencies.transport);
    this.cache = new SkillCache(dependencies.cacheDirectory, dependencies.now);
  }

  /** The connection that serves the project: its own, else the only shared one. */
  connectionFor(project: string): Connection {
    const { access } = this.dependencies.integrations();
    const serving = access.serving(SERVICE_REGISTRY_KIND, project);
    const own = serving.filter((one) => one.scope === 'project' && one.projectPath === project);
    if (own.length === 1) return own[0]!;
    if (own.length > 1)
      throw new Unavailable('several service-registry connections in the project');
    const shared = serving.filter((one) => one.scope === 'global');
    if (shared.length === 1) return shared[0]!;
    if (shared.length > 1) {
      throw new Unavailable('several shared service-registry connections; add one to the project');
    }
    throw new Unavailable('no service-registry connection');
  }

  /** The endpoint of a connection; `signal` is the time budget of the whole skill. */
  private async endpoint(connection: Connection, signal?: AbortSignal): Promise<McpEndpoint> {
    const base = registryBase(connection.params.url);
    if (base === null) throw new RegistryFailure('unreachable');
    let token: string;
    try {
      token = await this.dependencies.integrations().secrets.read(connection.id, 'token');
    } catch {
      throw new RegistryFailure('secret_unavailable');
    }
    return {
      base,
      token,
      proxyFor: this.dependencies.proxyFor,
      ...(signal === undefined ? {} : { signal }),
    };
  }

  /** The skills the connection offers for a query, versions from the highest down; a failure is an `AppError`. */
  async list(
    selector: { connection: string } | { project: string },
    query: string,
  ): Promise<RegistrySkill[]> {
    let connection: Connection;
    try {
      connection =
        'connection' in selector
          ? this.named(selector.connection)
          : this.connectionFor(selector.project);
      const found = await this.source.list(await this.endpoint(connection), query);
      return found.map((skill) => ({ ...skill, versions: sortVersionsDescending(skill.versions) }));
    } catch (error) {
      throw invalid('service-registry.skills', `cannot list skills: ${reasonOf(error)}`);
    }
  }

  private named(id: string): Connection {
    const { access } = this.dependencies.integrations();
    const connection = access.find(id);
    if (connection.kind !== SERVICE_REGISTRY_KIND) throw new Unavailable('not a service registry');
    if (!connection.enabled || connection.state !== 'ready' || !access.complete(connection)) {
      throw new Unavailable('the connection is disabled');
    }
    return connection;
  }

  /**
   * Fixes a version for every `registry:` reference: selects it, downloads it unless it is in
   * the cache. A reference that cannot be served is a warning, and nothing is fixed for it.
   */
  async pin(project: string, references: readonly string[]): Promise<PinResult> {
    const result: PinResult = { pinned: [], problems: [] };
    let connection: Connection | Unavailable | null = null;
    for (const text of references) {
      const parsed = parseRegistrySkill(text);
      if (!parsed.ok) {
        result.problems.push(`skill not found: ${text} (invalid reference)`);
        continue;
      }
      try {
        if (connection === null) {
          try {
            connection = this.connectionFor(project);
          } catch (error) {
            connection = error as Unavailable;
          }
        }
        if (connection instanceof Unavailable) throw connection;
        result.pinned.push(await this.pinOne(connection, parsed.ref));
      } catch (error) {
        result.problems.push(`skill not found: ${text} (${reasonOf(error)})`);
      }
    }
    return result;
  }

  private async pinOne(
    connection: Connection,
    ref: RegistrySkillRef,
  ): Promise<PinnedRegistrySkill> {
    // one budget for the list and the archive of the skill
    const signal = AbortSignal.timeout(SKILL_TIMEOUT_MS);
    let endpoint: McpEndpoint;
    let listed: RegistrySkill | undefined;
    try {
      endpoint = await this.endpoint(connection, signal);
      const skills = await this.source.list(endpoint, ref.name);
      listed = skills.find((skill) => skill.name === ref.name);
    } catch (error) {
      const cached = this.cachedVersion(connection.id, ref);
      if (cached !== null) return cached;
      throw error;
    }
    if (listed === undefined) throw new Unavailable('not found in the registry');
    const versions = listed.versions.filter((version) => parseVersion(version) !== null);
    const version = maxSatisfying(versions, ref.range);
    if (version === null) {
      const available = sortVersionsDescending(versions).join(', ');
      throw new Unavailable(
        ref.range === null
          ? 'the registry offers no versions'
          : `no available version matches ${ref.range} (available: ${available === '' ? 'none' : available})`,
      );
    }
    if (!this.cache.has(connection.id, ref.name, version)) {
      this.cache.store(
        connection.id,
        ref.name,
        version,
        await this.source.archive(endpoint, listed.id, version),
      );
    }
    return { name: ref.name, version, connection: connection.id };
  }

  /** The highest cached version of the reference: what a registry that does not answer leaves. */
  private cachedVersion(connection: string, ref: RegistrySkillRef): PinnedRegistrySkill | null {
    const version = maxSatisfying(this.cache.versions(connection, ref.name), ref.range);
    if (version === null || !this.cache.has(connection, ref.name, version)) return null;
    return { name: ref.name, version, connection };
  }

  /**
   * Lays the pinned skills out under `<directory>/.claude/skills`. A version that left the cache
   * is downloaded again through its connection. Returns the warnings.
   */
  async materialize(
    project: string,
    pinned: readonly PinnedRegistrySkill[],
    directory: string,
  ): Promise<string[]> {
    const problems: string[] = [];
    for (const skill of pinned) {
      try {
        if (!this.cache.has(skill.connection, skill.name, skill.version)) {
          await this.download(project, skill);
        }
        this.cache.copy(skill.connection, skill.name, skill.version, directory);
      } catch (error) {
        problems.push(
          `skill not found: ${registrySkillText({ name: skill.name, range: skill.version })} (${reasonOf(error)})`,
        );
      }
    }
    return problems;
  }

  private async download(project: string, skill: PinnedRegistrySkill): Promise<void> {
    const { access } = this.dependencies.integrations();
    let connection: Connection;
    try {
      connection = access.authorize(skill.connection, project);
    } catch {
      throw new Unavailable('connection_disabled');
    }
    const endpoint = await this.endpoint(connection, AbortSignal.timeout(SKILL_TIMEOUT_MS));
    const found = (await this.source.list(endpoint, skill.name)).find(
      (one) => one.name === skill.name && one.versions.includes(skill.version),
    );
    if (found === undefined) throw new Unavailable('not found in the registry');
    this.cache.store(
      connection.id,
      skill.name,
      skill.version,
      await this.source.archive(endpoint, found.id, skill.version),
    );
  }
}
