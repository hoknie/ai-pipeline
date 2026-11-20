import { rejected } from '../../../platform/errors/index.ts';
import type { IntegrationsServices } from '../../integrations/services/index.ts';
import { connectionServes, refusal, type Connection } from '../../integrations/types/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import { normalizeRemote } from '../../repos/types/index.ts';
import type { LinkRepository } from '../repositories/index.ts';
import {
  AUTO_LINK_INTERVAL_MS,
  REGISTRY_PATH_LIMIT,
  RegistryFailure,
  SERVICE_REGISTRY_KIND,
  type LinkStatus,
  type ProjectLink,
} from '../types/index.ts';

import { ToolRefused, type RegistryCalls } from './calls.ts';
import { LINK_CALL_TIMEOUT_MS, scanCatalog } from './catalog-scan.ts';

/** The most candidates an `ambiguous` link names. */
const CANDIDATES_LIMIT = 20;

/** Who asks for the matching: a command of the owner, the enabling of a connection or the start of an attempt. */
export type LinkTrigger = 'command' | 'enable' | 'attempt';

export interface LinkDependencies {
  links: LinkRepository;
  /** The `origin` of a project of aip. */
  origins: { originOf(path: string): Promise<string | null> };
  repositories: Pick<RegistryService, 'entries'>;
  /** The connections and their secrets; resolved when a call needs them. */
  integrations: () => Pick<IntegrationsServices, 'access' | 'secrets'>;
  calls: RegistryCalls;
  now: () => number;
}

/** What the start of an attempt learns about the project of the registry. */
export interface ProjectOfRegistry {
  path: string;
  server: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text a refusal of a failed registry call carries: static, never a text of the registry. */
function failureText(code: string): string {
  return code === 'unauthorized'
    ? 'the service registry refused the token of the connection'
    : 'the service registry is unreachable';
}

/**
 * The links of the projects of aip to the projects of a service registry: the automatic matching
 * by `origin`, the manual link, the clearing, and what an attempt learns from them.
 */
export class RegistryLinks {
  private readonly dependencies: LinkDependencies;
  /** The matchings that run now: a pair is matched by one call at a time. */
  private readonly running = new Map<string, Promise<ProjectLink>>();

  constructor(dependencies: LinkDependencies) {
    this.dependencies = dependencies;
  }

  /** The rows of a project, or of all projects. */
  list(project?: string): ProjectLink[] {
    return this.dependencies.links.all(project);
  }

  find(project: string, connectionId: string): ProjectLink | undefined {
    return this.dependencies.links.find(project, connectionId);
  }

  /** The links of a project that moved follow it. */
  moveProject(from: string, to: string): void {
    this.dependencies.links.moveProject(from, to);
  }

  /** A project that left aip: the links of shared connections to it go. */
  forgetProject(project: string): void {
    this.dependencies.links.forgetProject(project);
  }

  /** Forgets the link of a pair and switches the automatic matching of it off until `--auto`. */
  clear(project: string, connectionId: string): ProjectLink {
    this.connectionOf(project, connectionId, false);
    const row = this.row(project, connectionId, 'disabled', null, null, []);
    this.dependencies.links.put(row);
    return row;
  }

  /**
   * Links the pair to `path` after the registry confirmed it through `get_project`; a path the
   * registry does not know, or a registry that does not answer, changes nothing.
   */
  async manualLink(project: string, connectionId: string, path: string): Promise<ProjectLink> {
    const trimmed = path.trim();
    // eslint-disable-next-line no-control-regex
    if (trimmed === '' || trimmed.length > REGISTRY_PATH_LIMIT || /[\u0000-\u001f]/.test(trimmed)) {
      throw rejected('the path of a registry project is empty, too long or has control characters');
    }
    const connection = this.connectionOf(project, connectionId, true);
    const token = await this.tokenOf(connection);
    let answer: unknown;
    try {
      answer = await this.dependencies.calls.call(
        connection,
        token,
        'get_project',
        { project: trimmed },
        LINK_CALL_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof ToolRefused) {
        throw rejected(`project ${trimmed} is not found in the service registry`);
      }
      throw rejected(failureText(error instanceof RegistryFailure ? error.code : 'unreachable'));
    }
    if (!isObject(answer))
      throw rejected(`project ${trimmed} is not found in the service registry`);
    const canonical = typeof answer.path === 'string' && answer.path !== '' ? answer.path : trimmed;
    const row = this.row(project, connectionId, 'linked', canonical, 'manual', []);
    this.dependencies.links.put(row);
    return row;
  }

  /**
   * Matches the pair by `origin`. A manual link stays; a cleared pair stays cleared unless the
   * owner asks (`command`); a pair without a link is not asked about again within an hour unless
   * the owner asks. A registry that fails leaves the link it has as it is.
   */
  autoLink(project: string, connectionId: string, trigger: LinkTrigger): Promise<ProjectLink> {
    const key = `${project}\u0000${connectionId}`;
    const running = this.running.get(key);
    if (running !== undefined) return running;
    const work = this.matching(project, connectionId, trigger).finally(() =>
      this.running.delete(key),
    );
    this.running.set(key, work);
    return work;
  }

  /** After the enabling of a connection: every project it serves is matched. */
  async autoLinkServed(connectionId: string): Promise<void> {
    const { access } = this.dependencies.integrations();
    let connection: Connection;
    try {
      connection = access.find(connectionId);
    } catch {
      return;
    }
    if (connection.kind !== SERVICE_REGISTRY_KIND) return;
    const projects =
      connection.projectPath !== null
        ? [connection.projectPath]
        : this.dependencies.repositories
            .entries()
            .filter((entry) => entry.enabled !== false)
            .map((entry) => entry.path);
    for (const project of projects) {
      try {
        await this.autoLink(project, connectionId, 'enable');
      } catch {
        // a project that cannot be matched now is matched when an attempt starts
      }
    }
  }

  /**
   * The project of the registry for an attempt of `project` whose specialist has servers through
   * connections of these names; the first server that has a link. A pair with no link is matched
   * when the rules of the trigger `attempt` allow it. Never throws: no answer is null.
   */
  async projectFor(
    project: string,
    servers: readonly { server: string; connection: string }[],
  ): Promise<ProjectOfRegistry | null> {
    const { access } = this.dependencies.integrations();
    for (const { server, connection: name } of servers) {
      try {
        const connection = access.named(SERVICE_REGISTRY_KIND, name, project);
        if (connection === undefined) continue;
        access.authorize(connection.id, project);
        let link = this.dependencies.links.find(project, connection.id);
        if (link?.status !== 'linked')
          link = await this.autoLink(project, connection.id, 'attempt');
        if (link.status === 'linked' && link.registryPath !== null) {
          return { path: link.registryPath, server };
        }
      } catch {
        // a connection that cannot be used gives no line; the attempt starts without it
      }
    }
    return null;
  }

  private async matching(
    project: string,
    connectionId: string,
    trigger: LinkTrigger,
  ): Promise<ProjectLink> {
    const { links, now } = this.dependencies;
    const existing = links.find(project, connectionId);
    if (existing?.source === 'manual') return existing;
    if (existing !== undefined && trigger !== 'command') {
      if (existing.status === 'disabled') return existing;
      const fresh = now() - existing.matchedAt < AUTO_LINK_INTERVAL_MS;
      if (existing.status === 'linked' || (fresh && trigger === 'attempt')) return existing;
    }
    const connection = this.connectionOf(project, connectionId, true);
    const origin = await this.dependencies.origins.originOf(project);
    const wanted = origin === null ? null : normalizeRemote(origin);
    // Without an origin there is nothing to compare: a link that was found stays, as after a failure.
    if (wanted === null) return this.keep(existing, project, connectionId, 'no_match');
    let token: string;
    try {
      token = await this.tokenOf(connection);
    } catch (error) {
      if (trigger === 'command') throw error;
      return this.keep(existing, project, connectionId, 'unreachable');
    }
    let scanned: { paths: string[]; truncated: boolean };
    try {
      scanned = await scanCatalog(this.dependencies.calls, connection, token, wanted);
    } catch (error) {
      const code =
        error instanceof RegistryFailure && error.code === 'unauthorized'
          ? 'unauthorized'
          : 'unreachable';
      const meanwhile = this.settledMeanwhile(project, connectionId, trigger);
      if (meanwhile !== undefined) return meanwhile;
      return this.keep(existing, project, connectionId, code);
    }
    const found = scanned.paths;
    const truncated = scanned.truncated;
    const meanwhile = this.settledMeanwhile(project, connectionId, trigger);
    if (meanwhile !== undefined) return meanwhile;
    const unique = [...new Set(found)];
    if (unique.length === 1) {
      return this.settle(project, connectionId, 'linked', unique[0]!, []);
    }
    if (unique.length > 1) {
      return this.settle(
        project,
        connectionId,
        'ambiguous',
        null,
        unique.slice(0, CANDIDATES_LIMIT),
      );
    }
    return this.settle(project, connectionId, truncated ? 'truncated' : 'no_match', null, []);
  }

  /**
   * The row the pair got while the registry was asked, when it must stay: a manual link or a
   * clearing made meanwhile is not overwritten by an answer that was already on its way.
   */
  private settledMeanwhile(
    project: string,
    connectionId: string,
    trigger: LinkTrigger,
  ): ProjectLink | undefined {
    const current = this.dependencies.links.find(project, connectionId);
    if (current?.source === 'manual') return current;
    if (current?.status === 'disabled' && trigger !== 'command') return current;
    return undefined;
  }

  /** A failed matching: the link the pair has stays, a pair without one records why. */
  private keep(
    existing: ProjectLink | undefined,
    project: string,
    connectionId: string,
    status: LinkStatus,
  ): ProjectLink {
    if (existing?.status === 'linked') return existing;
    return this.settle(project, connectionId, status, null, []);
  }

  private settle(
    project: string,
    connectionId: string,
    status: LinkStatus,
    registryPath: string | null,
    candidates: string[],
  ): ProjectLink {
    const row = this.row(
      project,
      connectionId,
      status,
      registryPath,
      registryPath === null ? null : 'auto',
      candidates,
    );
    this.dependencies.links.put(row);
    return row;
  }

  private row(
    project: string,
    connectionId: string,
    status: LinkStatus,
    registryPath: string | null,
    source: ProjectLink['source'],
    candidates: string[],
  ): ProjectLink {
    return {
      project,
      connectionId,
      registryPath,
      source,
      status,
      candidates,
      matchedAt: this.dependencies.now(),
    };
  }

  /** The connection of the pair: a registry that serves the project (and, to call it, is usable). */
  private connectionOf(project: string, connectionId: string, usable: boolean): Connection {
    const { access } = this.dependencies.integrations();
    const connection = access.find(connectionId);
    if (connection.kind !== SERVICE_REGISTRY_KIND) {
      throw rejected('the connection is not a service registry');
    }
    if (!connectionServes(connection, project)) throw refusal('scope_denied');
    return usable ? access.authorize(connectionId, project) : connection;
  }

  private async tokenOf(connection: Connection): Promise<string> {
    const { secrets } = this.dependencies.integrations();
    try {
      return await secrets.read(connection.id, 'token');
    } catch {
      throw rejected('the token of the service registry connection is not available');
    }
  }
}
