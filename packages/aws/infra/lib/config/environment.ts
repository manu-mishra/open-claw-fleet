import { Environment } from './index';

export interface EnvironmentConfig {
  agentCount: number;
  cpu: number;
  memory: number;
}

const configs: Record<Environment, EnvironmentConfig> = {
  dev: {
    agentCount: 2,
    cpu: 256,
    memory: 512,
  },
  staging: {
    agentCount: 5,
    cpu: 512,
    memory: 1024,
  },
  prod: {
    agentCount: 20,
    cpu: 1024,
    memory: 2048,
  },
};

export const getConfig = (env: Environment): EnvironmentConfig => {
  return configs[env];
};