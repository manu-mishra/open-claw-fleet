export interface EnvironmentConfig {
  agentCount: number;
  cpu: number;
  memory: number;
  logRetentionDays: number;
  natGateways: number;
}

const configs: Record<string, EnvironmentConfig> = {
  dev: {
    agentCount: 2,
    cpu: 1024,
    memory: 2048,
    logRetentionDays: 7,
    natGateways: 1,
  },
  staging: {
    agentCount: 5,
    cpu: 512,
    memory: 1024,
    logRetentionDays: 14,
    natGateways: 1,
  },
  prod: {
    agentCount: 20,
    cpu: 1024,
    memory: 2048,
    logRetentionDays: 30,
    natGateways: 2,
  },
};

export const getEnvironmentConfig = (env: string): EnvironmentConfig => {
  return configs[env] || configs.dev;
};