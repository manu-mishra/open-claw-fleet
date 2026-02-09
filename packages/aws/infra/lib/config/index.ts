export * from './app-config';
export * from './environment-config';

// Re-export for convenience
export { Config } from './app-config';
export { getEnvironmentConfig as getConfig } from './environment-config';

export const environments = ['dev', 'staging', 'prod'] as const;
export type Environment = typeof environments[number];