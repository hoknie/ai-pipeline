import { validateObserverProfile } from '../feature/swarm-config/services/index.ts';
import { type FieldError } from '../feature/swarm-config/types/index.ts';
import {
  type ObserverProject,
  type ObserverSettings,
  OBSERVER_REPAIRS_MAX,
  OBSERVER_WORKERS_MAX,
} from '../feature/observers/types/index.ts';

const KEYS = ['enabled', 'workers', 'maxRepairs', 'answerHumanOnly', 'projects', 'specialist'];

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerIn(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: FieldError[],
): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errors.push({ path, message: `must be an integer from ${min} to ${max}` });
    return null;
  }
  return value;
}

export interface ObserverSettingsCheck {
  settings: ObserverSettings | null;
  errors: FieldError[];
}

/**
 * Checks new settings of the observers. Fields the value lacks keep their current value. The
 * profile is checked by the configuration; the ranges and the registry of repositories here.
 */
export function checkObserverSettings(
  value: Record<string, unknown>,
  current: ObserverSettings,
  repositories: ReadonlySet<string>,
): ObserverSettingsCheck {
  const errors: FieldError[] = [];
  for (const key of Object.keys(value)) {
    if (!KEYS.includes(key)) errors.push({ path: key, message: 'unknown key' });
  }
  const next: ObserverSettings = { ...current, projects: [...current.projects] };
  if ('enabled' in value) {
    if (typeof value.enabled === 'boolean') next.enabled = value.enabled;
    else errors.push({ path: 'enabled', message: 'must be a boolean' });
  }
  if ('answerHumanOnly' in value) {
    if (typeof value.answerHumanOnly === 'boolean') next.answerHumanOnly = value.answerHumanOnly;
    else errors.push({ path: 'answerHumanOnly', message: 'must be a boolean' });
  }
  if ('workers' in value) {
    const workers = integerIn(value.workers, 'workers', 1, OBSERVER_WORKERS_MAX, errors);
    if (workers !== null) next.workers = workers;
  }
  if ('maxRepairs' in value) {
    const maxRepairs = integerIn(value.maxRepairs, 'maxRepairs', 1, OBSERVER_REPAIRS_MAX, errors);
    if (maxRepairs !== null) next.maxRepairs = maxRepairs;
  }
  if ('projects' in value) {
    if (!Array.isArray(value.projects)) {
      errors.push({ path: 'projects', message: 'must be a list' });
    } else {
      const projects: ObserverProject[] = [];
      value.projects.forEach((entry: unknown, index) => {
        const path = `projects[${index}]`;
        if (!isMapping(entry)) {
          errors.push({ path, message: 'must be a mapping' });
          return;
        }
        for (const key of Object.keys(entry)) {
          if (key !== 'repository' && key !== 'maxWorkers') {
            errors.push({ path: `${path}.${key}`, message: 'unknown key' });
          }
        }
        const { repository } = entry;
        if (typeof repository !== 'string' || !repositories.has(repository)) {
          errors.push({ path: `${path}.repository`, message: 'is not a known repository' });
        } else if (projects.some((project) => project.repository === repository)) {
          errors.push({ path: `${path}.repository`, message: 'is listed twice' });
        }
        let maxWorkers: number | null = null;
        if (entry.maxWorkers !== null && entry.maxWorkers !== undefined) {
          maxWorkers = integerIn(
            entry.maxWorkers,
            `${path}.maxWorkers`,
            1,
            OBSERVER_WORKERS_MAX,
            errors,
          );
        }
        if (typeof repository === 'string') projects.push({ repository, maxWorkers });
      });
      next.projects = projects;
    }
  }
  if ('specialist' in value) {
    if (!isMapping(value.specialist)) {
      errors.push({ path: 'specialist', message: 'must be a mapping' });
    } else {
      next.specialist = value.specialist;
    }
  }
  errors.push(...validateObserverProfile(next.specialist).errors);
  return errors.length === 0 ? { settings: next, errors } : { settings: null, errors };
}
