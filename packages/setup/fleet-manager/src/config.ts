import { readFile } from 'fs/promises';
import { parse } from 'yaml';

export interface ModelConfig {
  primary: string;
  fallbacks?: string[];
}

export interface DepartmentConfig {
  enabled: boolean;
  vp: number;
  directors: number;
  managers: number;
  ics: number;
  skills?: string[];
  model?: ModelConfig;
  template?: string;
}

export interface AgentOverride {
  skills?: string[];
  model?: ModelConfig;
  template?: string;
}

export interface FleetConfig {
  ceo: {
    name: string;
    matrixId: string;
  };
  defaults: {
    model: ModelConfig;
    skills: string[];
    requireMention?: boolean;
    heartbeatMinutes?: number;
  };
  matrix: {
    homeserver: string;
    domain: string;
  };
  departments: Record<string, DepartmentConfig>;
  agents?: Record<string, AgentOverride>;
}

export async function loadConfig(configPath: string): Promise<FleetConfig> {
  const content = await readFile(configPath, 'utf-8');
  return parse(content) as FleetConfig;
}
