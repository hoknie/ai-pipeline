import { randomInt } from 'node:crypto';

import type { RegistryService } from '../../repos/services/index.ts';
import type { TagsPublishPort } from '../ports/index.ts';
import type { TagRepository } from '../repositories/index.ts';
import {
  addLinkedTag,
  addTag,
  editTag,
  tagId,
  tagsOfRepository,
  type Tag,
  type TagTask,
} from '../types/index.ts';

export interface TagCatalogDependencies {
  tags: TagRepository;
  registry: RegistryService;
  now: () => number;
  publish: TagsPublishPort;
}

/** A new tag: the name and the color of the user, or a linked tag of a task. */
export interface NewTag {
  repository: string;
  name: string;
  color?: string | undefined;
  task?: TagTask | undefined;
}

/** The tag catalogs of all repositories, kept in memory and in the database. */
export class TagCatalogService {
  private readonly dependencies: TagCatalogDependencies;
  private catalog: Tag[] = [];

  constructor(dependencies: TagCatalogDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads the catalog from the database; called once at the start. */
  load(): void {
    this.catalog = this.dependencies.tags.tags();
  }

  /** The tags of every repository. */
  all(): Tag[] {
    return this.catalog;
  }

  /** The tags of one repository; names are unique and resolved inside it only. */
  of(repository: string): Tag[] {
    return tagsOfRepository(this.catalog, repository);
  }

  /** The catalog of the repository that holds `path`. */
  async catalogFor(path: string): Promise<Tag[]> {
    return this.of(await this.dependencies.registry.rootOf(path));
  }

  /** Adds a tag to the catalog without telling the clients. */
  create(input: NewTag): Tag {
    const now = this.dependencies.now();
    let id = tagId(now, randomInt(36 ** 3));
    while (this.catalog.some((tag) => tag.id === id)) id = tagId(now, randomInt(36 ** 3));
    const tag = input.task
      ? addLinkedTag(
          this.of(input.repository),
          { name: input.name, task: input.task, repository: input.repository },
          id,
          now,
        )
      : addTag(this.of(input.repository), input, id, now);
    this.dependencies.tags.saveTag(tag);
    this.catalog = [...this.catalog, tag];
    return tag;
  }

  /** `tag_add`: returns the root of the repository whose catalog changed. */
  async add(input: { repository: string; name: string; color?: string | undefined }) {
    const repository = await this.dependencies.registry.rootOf(input.repository);
    this.create({ ...input, repository });
    this.publish(repository);
    return repository;
  }

  /** `tag_edit`: returns the root of the repository whose catalog changed. */
  async edit(input: {
    repository: string;
    tag: string;
    name?: string | undefined;
    color?: string | undefined;
  }): Promise<string> {
    const repository = await this.dependencies.registry.rootOf(input.repository);
    const tag = editTag(this.of(repository), input.tag, input);
    this.dependencies.tags.saveTag(tag);
    this.catalog = this.catalog.map((candidate) => (candidate.id === tag.id ? tag : candidate));
    this.publish(repository);
    return repository;
  }

  /** Deletes the stored tag; no transaction of its own, the scenario of removing a tag opens it. */
  deleteStored(repository: string, id: string): void {
    this.dependencies.tags.deleteTag(repository, id);
  }

  /** Drops a deleted tag from the catalog in memory. */
  forget(id: string): void {
    this.catalog = this.catalog.filter((tag) => tag.id !== id);
  }

  /** Tells the clients about the catalogs. */
  publish(repository: string): void {
    this.dependencies.publish.tagsChanged(repository);
  }
}
