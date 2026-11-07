export const OBSERVER_WORKERS_MAX = 20;

export const OBSERVER_REPAIRS_MAX = 50;

export interface ObserverProject {
  repository: string;
  /** `null`: the project has no limit of its own. */
  maxWorkers: number | null;
}

/** Settings of the observers; one set per daemon. */
export interface ObserverSettings {
  enabled: boolean;
  workers: number;
  maxRepairs: number;
  answerHumanOnly: boolean;
  projects: ObserverProject[];
  /** YAML fields of the specialist: name, model, runtime, permissions, timeout, tools, prompt, … */
  specialist: Record<string, unknown>;
}

export function defaultObserverSettings(): ObserverSettings {
  return {
    enabled: false,
    workers: 1,
    maxRepairs: 5,
    answerHumanOnly: false,
    projects: [],
    specialist: {},
  };
}
