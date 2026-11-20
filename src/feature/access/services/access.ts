import type { RegistryService } from '../../repos/services/index.ts';
import type { Actor, User } from '../../identity/types/index.ts';
import type { AccessPolicy, AccessRole } from '../../swarm-config/types/index.ts';
import {
  ACTIONS,
  type ActionInfo,
  evaluate,
  type Decision,
  type Resource,
} from '../types/index.ts';

/** The projects a subject may read: all of them, or the listed paths. */
export interface Readable {
  all: boolean;
  has(path: string): boolean;
}

export interface AccessDependencies {
  /** The policy in effect now. */
  policy: () => AccessPolicy;
  defaultRole: () => AccessRole | null;
  registry: RegistryService;
  users: { list(): User[] };
}

/** What a user may do in a project: the actions, and those only with `author: self`. */
export interface AllowedActions {
  actions: string[];
  conditional: string[];
}

const EVERYTHING: Readable = { all: true, has: () => true };

/** Decides what a user may do, by the policy and the presets; `local` and `system` may do anything. */
export class AccessService {
  private readonly dependencies: AccessDependencies;

  constructor(dependencies: AccessDependencies) {
    this.dependencies = dependencies;
  }

  /** The resource with its project as a slug: a path of the registry is turned into one. */
  private resourceOf(resource: Resource): Resource {
    const reference = resource.repository;
    if (reference === undefined || reference === null) return resource;
    const slug = this.dependencies.registry.entry(reference)?.slug;
    return slug ? { ...resource, repository: slug } : resource;
  }

  /** The decision for the actor; `local` and `system` always pass. */
  authorize(actor: Actor, action: string, resource: Resource = {}): Decision {
    if (actor.kind !== 'user') return { effect: 'allow', matched: [], reason: 'allow' };
    return this.decide(actor.user.id, actor.attributes, action, resource);
  }

  /** The decision for a subject given by its attributes (the explanation of `aip access check`). */
  decide(
    id: string,
    attributes: Record<string, string[]>,
    action: string,
    resource: Resource = {},
  ): Decision {
    const { policy, defaultRole } = this.dependencies;
    return evaluate(policy(), { id, attributes }, action, this.resourceOf(resource), defaultRole());
  }

  can(actor: Actor, action: string, resource: Resource = {}): boolean {
    return this.authorize(actor, action, resource).effect === 'allow';
  }

  /** The projects with `project.read`; everything for `local` and `system`. */
  readableRepositories(actor: Actor): Readable {
    if (actor.kind !== 'user') return EVERYTHING;
    const paths = new Set(
      this.dependencies.registry
        .entries()
        .filter((entry) => this.can(actor, 'project.read', { repository: entry.path }))
        .map((entry) => entry.path),
    );
    // a path outside the registry (a project that left it) is not readable
    return { all: false, has: (path) => paths.has(path) };
  }

  /**
   * The actions the actor may do in a project (`null`: no project, the shared ones), and the actions
   * that need the resource to be the actor's own.
   */
  allowedActions(actor: Actor, repository: string | null): AllowedActions {
    const resource: Resource = repository === null ? {} : { repository };
    const actions: string[] = [];
    const conditional: string[] = [];
    for (const { name } of ACTIONS) {
      if (this.can(actor, name, resource)) actions.push(name);
      else if (
        actor.kind === 'user' &&
        this.can(actor, name, { ...resource, author: actor.user.id })
      ) {
        conditional.push(name);
      }
    }
    return { actions, conditional };
  }

  /** The catalog of the actions, for `aip access actions`. */
  catalog(): readonly ActionInfo[] {
    return ACTIONS;
  }

  /** The users that will be refused everything: no role, and no default one to stand for it. */
  usersWithoutRole(): User[] {
    if (this.dependencies.defaultRole() !== null) return [];
    return this.dependencies.users
      .list()
      .filter((user) => !user.disabled && (user.attributes.role ?? []).length === 0);
  }
}
