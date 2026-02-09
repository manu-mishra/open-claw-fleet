#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { resolve, join } from 'path';
import { readdir, mkdir, copyFile } from 'fs/promises';
import { App } from './app.js';
import { loadConfig, loadAvailableSkills, FleetConfig } from './config.js';

const CONFIG_DIR = 'config';
const ENVIRONMENTS_DIR = 'config/environments';

async function main() {
  const envDir = resolve(ENVIRONMENTS_DIR);
  const templatesDir = resolve(CONFIG_DIR, 'templates');

  // Load available skills
  const availableSkills = await loadAvailableSkills(templatesDir);

  // Load all environments
  const entries = await readdir(envDir, { withFileTypes: true });
  const environments = entries
    .filter(e => e.isDirectory() && e.name !== 'templates')
    .map(e => e.name);

  const configs = new Map<string, { path: string; config: FleetConfig }>();

  for (const env of environments) {
    const configPath = join(envDir, env, 'config.yaml');
    try {
      const config = await loadConfig(configPath);
      configs.set(env, { path: configPath, config });
    } catch { /* skip */ }
  }

  const createEnv = async (name: string) => {
    const newEnvDir = join(envDir, name);
    await mkdir(newEnvDir, { recursive: true });
    const templatePath = join(envDir, 'local', 'config.yaml');
    const newConfigPath = join(newEnvDir, 'config.yaml');
    await copyFile(templatePath, newConfigPath);
    const config = await loadConfig(newConfigPath);
    configs.set(name, { path: newConfigPath, config });
    environments.push(name);
  };

  const { waitUntilExit } = render(
    <App
      environments={environments}
      configs={configs}
      availableSkills={availableSkills}
      onCreateEnv={createEnv}
    />
  );

  await waitUntilExit();
}

main().catch(console.error);
