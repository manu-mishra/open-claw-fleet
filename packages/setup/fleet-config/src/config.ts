import { readFile, writeFile, readdir } from 'fs/promises';
import { parse, stringify } from 'yaml';
import { join } from 'path';

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

export interface FleetConfig {
  ceo: {
    name: string;
    matrixId: string;
  };
  defaults: {
    model: ModelConfig;
    skills: string[];
    requireMention?: boolean;
  };
  matrix: {
    homeserver: string;
    domain: string;
  };
  departments: Record<string, DepartmentConfig>;
  agents?: Record<string, any>;
}

export async function loadConfig(configPath: string): Promise<FleetConfig> {
  const content = await readFile(configPath, 'utf-8');
  return parse(content) as FleetConfig;
}

export async function saveConfig(configPath: string, config: FleetConfig): Promise<void> {
  const content = stringify(config, { lineWidth: 0 });
  await writeFile(configPath, content);
}

export interface SkillInfo {
  name: string;
  description: string;
  emoji?: string;
}

export async function loadAvailableSkills(templatesDir: string): Promise<SkillInfo[]> {
  const skillsDir = join(templatesDir, 'skills');
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: SkillInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const skillMd = await readFile(join(skillsDir, entry.name, 'SKILL.md'), 'utf-8');
      const frontmatter = skillMd.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatter) {
        const meta = parse(frontmatter[1]);
        skills.push({
          name: meta.name || entry.name,
          description: meta.description || '',
          emoji: meta.metadata?.openclaw?.emoji
        });
      } else {
        skills.push({ name: entry.name, description: '' });
      }
    } catch {
      skills.push({ name: entry.name, description: '' });
    }
  }

  return skills;
}
