import type { ObserverSettings } from '../../../shared/api/observerTypes.ts';
import type { FieldError } from '../../../shared/api/types.ts';
import type { ObserverTab } from '../../../shared/lib/nav/settingsGroups.ts';
import { draftOf, fieldOf, valueOf, type Draft } from '../../specialists/index.ts';

/** The fields of a specialist file the observer's specialist has no place for. */
export const NOT_OBSERVER_FIELDS = ['max', 'tags', 'queue'];
export const SPECIALIST_PREFIX = 'specialist.';

export interface ProjectDraft {
  connected: boolean;
  /** Empty: no limit of the project's own. */
  maxWorkers: string;
}

export interface Form {
  enabled: boolean;
  workers: string;
  maxRepairs: string;
  answerHumanOnly: boolean;
  specialist: Draft;
  projects: Record<string, ProjectDraft>;
}

export function formOf(settings: ObserverSettings): Form {
  const projects: Record<string, ProjectDraft> = {};
  for (const project of settings.projects) {
    projects[project.repository] = {
      connected: true,
      maxWorkers: project.maxWorkers === null ? '' : String(project.maxWorkers),
    };
  }
  return {
    enabled: settings.enabled,
    workers: String(settings.workers),
    maxRepairs: String(settings.maxRepairs),
    answerHumanOnly: settings.answerHumanOnly,
    specialist: draftOf(settings.specialist),
    projects,
  };
}

/** The form as compared for edits: a project switched on and off again is no edit. */
export const keyOf = (form: Form): string =>
  JSON.stringify({
    ...form,
    projects: Object.fromEntries(
      Object.entries(form.projects).filter(
        ([, project]) => project.connected || project.maxWorkers !== '',
      ),
    ),
  });

const numberOf = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text.trim()));

/** The settings a form stands for, with the connected projects in the order of the registry. */
export function settingsOf(
  form: Form,
  order: string[],
  raw: Record<string, unknown>,
): ObserverSettings {
  const known = new Set(order);
  const repositories = [
    ...order,
    ...Object.keys(form.projects).filter((repository) => !known.has(repository)),
  ];
  const specialist = Object.fromEntries(
    Object.entries(valueOf(form.specialist, raw)).filter(
      ([key]) => !NOT_OBSERVER_FIELDS.includes(key),
    ),
  );
  return {
    enabled: form.enabled,
    workers: numberOf(form.workers),
    maxRepairs: numberOf(form.maxRepairs),
    answerHumanOnly: form.answerHumanOnly,
    projects: repositories.flatMap((repository) => {
      const project = form.projects[repository];
      if (!project?.connected) return [];
      return [
        {
          repository,
          maxWorkers: project.maxWorkers.trim() === '' ? null : numberOf(project.maxWorkers),
        },
      ];
    }),
    specialist,
  };
}

const PROJECT_PATH = /^projects\[(\d+)\]\.maxWorkers$/;

/** The errors of the server sorted by the place of the form they belong to. */
export function groupErrors(errors: FieldError[], sent: string[], order: string[]) {
  const at = (path: string) => errors.filter((error) => error.path === path);
  const specialist = errors.filter((error) => error.path.startsWith(SPECIALIST_PREFIX));
  const projectOf = (path: string): string | null => {
    const match = PROJECT_PATH.exec(path);
    const repository = match ? sent[Number(match[1])] : undefined;
    return repository !== undefined && order.includes(repository) ? repository : null;
  };
  const known = (error: FieldError) =>
    error.path === 'workers' ||
    error.path === 'maxRepairs' ||
    projectOf(error.path) !== null ||
    (error.path.startsWith(SPECIALIST_PREFIX) && fieldOf(error.path, SPECIALIST_PREFIX) !== null);
  return {
    at,
    specialist,
    project: (repository: string) => errors.filter((error) => projectOf(error.path) === repository),
    other: errors.filter((error) => !known(error)),
    tabHasErrors: (key: ObserverTab) =>
      key === 'general'
        ? at('workers').length + at('maxRepairs').length > 0
        : key === 'specialist'
          ? specialist.length > 0
          : errors.some((error) => projectOf(error.path) !== null),
  };
}

export type ErrorGroups = ReturnType<typeof groupErrors>;
