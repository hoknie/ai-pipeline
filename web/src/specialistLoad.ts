import type { RunView } from './types.ts';

export type UseLevel = 'global' | 'project';

/** A group that runs on a specialist or waits for it, with the run and the repository it is in. */
export interface LoadEntry {
  runId: string;
  runTitle: string;
  repository: string;
  workflow: string;
  level: UseLevel;
  /** Slug of the group. */
  group: string;
  title: string;
  step: string;
  /** The human name of the step. */
  stepName: string;
  status: 'running' | 'queued';
}

export interface SlugLoad {
  specialist: string;
  /** The smallest limit among the runs; null when no run limits the specialist. */
  max: number | null;
  running: LoadEntry[];
  waiting: LoadEntry[];
}

export type MachineLoad = Map<string, SlugLoad>;

/** Running and waiting groups of every specialist across the unfinished runs of all repositories. */
export function machineLoad(runs: readonly RunView[]): MachineLoad {
  const load: MachineLoad = new Map();
  for (const run of runs) {
    if (run.finished) continue;
    for (const use of run.specialists ?? []) {
      let slug = load.get(use.specialist);
      if (!slug) {
        slug = { specialist: use.specialist, max: null, running: [], waiting: [] };
        load.set(use.specialist, slug);
      }
      if (use.max !== null && use.max > 0 && (slug.max === null || use.max < slug.max)) {
        slug.max = use.max;
      }
      const base = {
        runId: run.id,
        runTitle: run.title,
        repository: run.repository,
        workflow: run.workflow,
        level: use.level,
      };
      for (const item of use.running) {
        slug.running.push({
          ...base,
          group: item.slug,
          title: item.title,
          step: item.step,
          stepName: item.stepName ?? item.step,
          status: 'running',
        });
      }
      for (const item of use.waiting) {
        slug.waiting.push({
          ...base,
          group: item.slug,
          title: item.title,
          step: item.step,
          stepName: item.stepName ?? item.step,
          status: 'queued',
        });
      }
    }
  }
  return load;
}

export interface RepositoryUse {
  repository: string;
  running: LoadEntry[];
  waiting: LoadEntry[];
}

export interface GlobalSection {
  specialist: string;
  max: number | null;
  /** Running and waiting of the slug over the whole machine, every repository and level. */
  running: number;
  waiting: number;
  repositories: RepositoryUse[];
}

export interface ProjectSpecialist {
  specialist: string;
  max: number | null;
  /** Running of the slug over the whole machine. */
  totalRunning: number;
  running: LoadEntry[];
  waiting: LoadEntry[];
}

export interface ProjectSection {
  repository: string;
  running: number;
  waiting: number;
  specialists: ProjectSpecialist[];
}

export interface LoadSections {
  global: GlobalSection[];
  project: ProjectSection[];
  running: number;
  waiting: number;
}

function byText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function repositoryOrder(selected: string | null) {
  return (left: string, right: string): number =>
    Number(right === selected) - Number(left === selected) || byText(left, right);
}

/** The panel blocks: global specialists by repository, project ones by repository. */
export function loadSections(load: MachineLoad, selected: string | null): LoadSections {
  const order = repositoryOrder(selected);
  const global: GlobalSection[] = [];
  const projects = new Map<string, ProjectSection>();
  let running = 0;
  let waiting = 0;
  for (const slug of [...load.values()].sort((a, b) => byText(a.specialist, b.specialist))) {
    if (slug.running.length === 0 && slug.waiting.length === 0) continue;
    running += slug.running.length;
    waiting += slug.waiting.length;
    const globals = new Map<string, RepositoryUse>();
    const locals = new Map<string, RepositoryUse>();
    const put = (entry: LoadEntry) => {
      const target = entry.level === 'global' ? globals : locals;
      let use = target.get(entry.repository);
      if (!use) {
        use = { repository: entry.repository, running: [], waiting: [] };
        target.set(entry.repository, use);
      }
      (entry.status === 'running' ? use.running : use.waiting).push(entry);
    };
    slug.running.forEach(put);
    slug.waiting.forEach(put);
    if (globals.size > 0) {
      const repositories = [...globals.values()].sort((a, b) => order(a.repository, b.repository));
      global.push({
        specialist: slug.specialist,
        max: slug.max,
        running: slug.running.length,
        waiting: slug.waiting.length,
        repositories,
      });
    }
    for (const [repository, use] of locals) {
      let section = projects.get(repository);
      if (!section) {
        section = { repository, running: 0, waiting: 0, specialists: [] };
        projects.set(repository, section);
      }
      section.running += use.running.length;
      section.waiting += use.waiting.length;
      section.specialists.push({
        specialist: slug.specialist,
        max: slug.max,
        totalRunning: slug.running.length,
        running: use.running,
        waiting: use.waiting,
      });
    }
  }
  return {
    global,
    project: [...projects.values()].sort((a, b) => order(a.repository, b.repository)),
    running,
    waiting,
  };
}
