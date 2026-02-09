export interface AppConfig {
  appName: string;
  environment: 'dev' | 'staging' | 'prod';
}

export const appConfig: AppConfig = {
  appName: 'open-claw-fleet',
  environment: (process.env.ENVIRONMENT as 'dev' | 'staging' | 'prod') || 'dev',
};

// Convenience object for common operations
export const Config = {
  projectPrefix: 'open-claw-fleet',
  environments: ['dev'] as const,
  
  getStackName: (type: string, env?: string) => 
    env ? `open-claw-fleet-${env}` : `open-claw-fleet-${type}`,
};
