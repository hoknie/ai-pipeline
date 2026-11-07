import { ProcessService, type ProcessDependencies } from './processes.ts';

export interface ProcessesServices {
  processes: ProcessService;
}

export function createProcessesServices(dependencies: ProcessDependencies): ProcessesServices {
  return { processes: new ProcessService(dependencies) };
}
