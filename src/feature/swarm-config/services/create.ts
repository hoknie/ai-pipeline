import { ConfigService } from './settings.ts';

export interface SwarmConfigServices {
  config: ConfigService;
}

export function createSwarmConfigServices(dependencies: {
  environment: NodeJS.ProcessEnv;
}): SwarmConfigServices {
  return { config: new ConfigService(dependencies) };
}
