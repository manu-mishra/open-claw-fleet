import { mkdir, writeFile, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { FleetConfig } from './config.js';
import { Org, Person } from './org.js';
import { SelectedAgent } from './resolver.js';

export interface GenerateOptions {
  outputDir: string;
  templatesDir: string;
  dryRun?: boolean;
}

export async function generateWorkspaces(
  config: FleetConfig,
  org: Org,
  agents: SelectedAgent[],
  opts: GenerateOptions
): Promise<void> {
  const byMatrixId = new Map(org.people.map(p => [p.matrixId, p]));
  const deployedIds = new Set(agents.map(a => a.matrixId));
  if (config.ceo?.matrixId) deployedIds.add(config.ceo.matrixId);
  const filteredOrg = buildFilteredOrg(org, deployedIds);

  // Write org.json
  if (!opts.dryRun) {
    await mkdir(opts.outputDir, { recursive: true });
    await writeFile(join(opts.outputDir, 'org.json'), JSON.stringify(org, null, 2));
    await writeFile(join(opts.outputDir, 'deployed-org.json'), JSON.stringify(filteredOrg, null, 2));
  }
  console.log(`${opts.dryRun ? '[DRY RUN] ' : ''}Generated org.json (${org.people.length} people)`);

  const expectedAgentDirs = new Set(
    agents.map((agent) =>
      join(opts.outputDir, agent.department, workspaceDirectoryName(agent.matrixId, config.matrix.domain))
    )
  );

  if (!opts.dryRun) {
    await pruneStaleAgentWorkspaces(opts.outputDir, expectedAgentDirs);
  }

  for (const agent of agents) {
    // Use sanitized matrix ID as directory name (matches ECS orchestrator)
    const agentDir = join(opts.outputDir, agent.department, workspaceDirectoryName(agent.matrixId, config.matrix.domain));

    if (!opts.dryRun) {
      await mkdir(agentDir, { recursive: true });

      // Generate all template files
      const context = buildContext(agent, byMatrixId, deployedIds);

      // IDENTITY.md from shared template
      const identityTpl = await loadTemplate(opts.templatesDir, 'shared/IDENTITY.md');
      await writeFile(join(agentDir, 'IDENTITY.md'), render(identityTpl, context));

      // SOUL.md from shared template
      const soulTpl = await loadTemplate(opts.templatesDir, 'shared/SOUL.md');
      await writeFile(join(agentDir, 'SOUL.md'), render(soulTpl, context));

      // AGENTS.md composed from level + department
      const agentsMd = await composeAgentsMd(agent, config, opts.templatesDir, context);
      await writeFile(join(agentDir, 'AGENTS.md'), agentsMd);

      // Runtime system prompt composed from shared + role + department templates
      const systemPrompt = await composeSystemPrompt(agent, opts.templatesDir, context);

      // HEARTBEAT.md from shared
      const heartbeatTpl = await loadTemplate(opts.templatesDir, 'shared/HEARTBEAT.md');
      await writeFile(join(agentDir, 'HEARTBEAT.md'), render(heartbeatTpl, context));

      // Copy relevant skills
      await copySkills(agent.resolvedSkills, opts.templatesDir, agentDir);

      // openclaw.json
      await writeFile(join(agentDir, 'openclaw.json'), JSON.stringify(renderConfig(agent, config, systemPrompt), null, 2));

      // Filtered org.json - CEO + deployed agents only
      await writeFile(join(agentDir, 'org.json'), JSON.stringify(filteredOrg, null, 2));
    }

    console.log(`${opts.dryRun ? '[DRY RUN] ' : ''}Generated ${agentDir}`);
  }
}

function workspaceDirectoryName(matrixId: string, domain: string): string {
  return matrixId.replace(/[@:]/g, '').replace(domain, '');
}

function buildFilteredOrg(org: Org, deployedIds: Set<string>): Org {
  const filteredPeople = org.people
    .filter((person) => deployedIds.has(person.matrixId))
    .map((person) => ({
      ...person,
      directReports: person.directReports.filter((id) => deployedIds.has(id)),
      reportsTo: person.reportsTo && deployedIds.has(person.reportsTo) ? person.reportsTo : null,
    }));

  const departments = org.departments
    .map((department) => {
      const deptPeople = filteredPeople.filter((person) => person.department === department.name);
      const teams = Array.from(
        new Set(deptPeople.map((person) => person.team).filter((team): team is string => Boolean(team)))
      ).sort();
      const vp = deptPeople.find((person) => person.level === 'VP')?.matrixId ?? '';
      return {
        name: department.name,
        vp,
        teams,
        headcount: deptPeople.length,
      };
    })
    .filter((department) => department.headcount > 0);

  return { departments, people: filteredPeople };
}

async function pruneStaleAgentWorkspaces(outputDir: string, expectedAgentDirs: Set<string>): Promise<void> {
  const removed: string[] = [];
  const departmentEntries = await readdir(outputDir, { withFileTypes: true });

  for (const department of departmentEntries) {
    if (!department.isDirectory() || department.name.startsWith('.')) {
      continue;
    }

    const departmentPath = join(outputDir, department.name);
    const entries = await readdir(departmentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }

      const workspacePath = join(departmentPath, entry.name);
      if (expectedAgentDirs.has(workspacePath)) {
        continue;
      }

      await rm(workspacePath, { recursive: true, force: true });
      removed.push(workspacePath);
    }

    const remaining = await readdir(departmentPath);
    if (remaining.length === 0) {
      await rm(departmentPath, { recursive: true, force: true });
    }
  }

  if (removed.length > 0) {
    console.log(`Pruned ${removed.length} stale workspace(s)`);
  }
}

function buildContext(agent: SelectedAgent, byMatrixId: Map<string, Person>, deployedIds: Set<string>): Record<string, any> {
  const manager = agent.reportsTo && deployedIds.has(agent.reportsTo) ? byMatrixId.get(agent.reportsTo) : null;
  const reports = agent.directReports
    .filter(id => deployedIds.has(id))
    .map(id => byMatrixId.get(id))
    .filter(Boolean) as Person[];

  return {
    ...agent,
    manager,
    directReports: reports,
    [`level_${agent.level}`]: true,  // level_VP, level_Director, etc.
  };
}

async function loadTemplate(templatesDir: string, path: string): Promise<string> {
  try {
    return await readFile(join(templatesDir, path), 'utf-8');
  } catch {
    return '';
  }
}

function render(template: string, context: Record<string, any>): string {
  let result = template;

  // Handle conditionals: {{#key}}...{{/key}}
  result = result.replace(/\{\{#(\w+(?:\.\w+)?)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    const value = getNestedValue(context, key);
    if (value) return render(content, context);
    return '';
  });

  // Handle simple replacements: {{key}}
  result = result.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, key) => {
    const value = getNestedValue(context, key);
    return value != null ? String(value) : '';
  });

  return result;
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

async function composeAgentsMd(
  agent: SelectedAgent,
  config: FleetConfig,
  templatesDir: string,
  context: Record<string, any>
): Promise<string> {
  const parts: string[] = [];

  // Level template
  const levelTpl = await loadTemplate(templatesDir, `levels/${agent.level}.md`);
  if (levelTpl) parts.push(render(levelTpl, context));

  // Department template
  const deptPath = agent.resolvedTemplate ?? `departments/${agent.department}.md`;
  let deptTpl = await loadTemplate(templatesDir, deptPath);
  if (!deptTpl) deptTpl = await loadTemplate(templatesDir, 'departments/_default.md');
  if (deptTpl) parts.push(render(deptTpl, context));

  return parts.join('\n\n---\n\n') || '# Agent\n\nNo templates configured.';
}

async function composeSystemPrompt(
  agent: SelectedAgent,
  templatesDir: string,
  context: Record<string, any>
): Promise<string> {
  const parts: string[] = [];

  const sharedTpl = await loadTemplate(templatesDir, 'prompts/shared/system.md');
  if (sharedTpl) parts.push(render(sharedTpl, context));

  let roleTpl = await loadTemplate(templatesDir, `prompts/roles/${agent.level}.md`);
  if (!roleTpl) roleTpl = await loadTemplate(templatesDir, 'prompts/roles/_default.md');
  if (roleTpl) parts.push(render(roleTpl, context));

  let deptTpl = await loadTemplate(templatesDir, `prompts/departments/${agent.department}.md`);
  if (!deptTpl) deptTpl = await loadTemplate(templatesDir, 'prompts/departments/_default.md');
  if (deptTpl) parts.push(render(deptTpl, context));

  return parts.join('\n\n').trim();
}

async function copySkills(skills: string[], templatesDir: string, agentDir: string): Promise<void> {
  const skillsDir = join(agentDir, 'skills');
  // Reset skills directory on each generation to avoid stale/removed skills lingering.
  await rm(skillsDir, { recursive: true, force: true });
  await mkdir(skillsDir, { recursive: true });

  for (const skill of skills) {
    const srcDir = join(templatesDir, 'skills', skill);
    const destDir = join(skillsDir, skill);
    try {
      await mkdir(destDir, { recursive: true });
      const files = await readdir(srcDir);
      for (const file of files) {
        const content = await readFile(join(srcDir, file), 'utf-8');
        await writeFile(join(destDir, file), content);
      }
    } catch { /* skill not found */ }
  }
}

function defaultSystemPrompt(agent: SelectedAgent): string {
  return `You are ${agent.name}, ${agent.title} at AnyCompany Corp. Stay in character. Use the "people" tool for org lookups and the "tasks" tool for Command Center tasks. If you cannot proceed, set the task to blocked with blockedReason and nextAction.`;
}

function renderConfig(agent: SelectedAgent, config: FleetConfig, systemPrompt: string): object {
  const heartbeatMinutes = config.defaults.heartbeatMinutes ?? 5;
  return {
    models: {
      bedrockDiscovery: {
        enabled: true,
        region: process.env.AWS_REGION || 'us-east-1',
        providerFilter: ['anthropic', 'amazon', 'openai']
      }
    },
    tools: {
      profile: "full"
    },
    agents: {
      defaults: {
        model: agent.resolvedModel,
        heartbeat: { every: `${heartbeatMinutes}m` },
        thinkingDefault: "off",
        verboseDefault: "off",
        subagents: {
          thinking: "off"
        }
      }
    },
    session: {
      agentToAgent: {
        maxPingPongTurns: 0
      }
    },
    plugins: {
      allow: ["matrix", "people", "command-center"],
      load: {
        paths: ["/opt/plugins/people/people.js", "/opt/plugins/command-center/command-center.js"]
      },
      entries: {
        matrix: { enabled: true },
        people: { enabled: true },
        "command-center": { enabled: true }
      }
    },
    channels: {
      matrix: {
        enabled: true,
        homeserver: config.matrix.homeserver,
        userId: agent.matrixId,
        actions: { memberInfo: false },
        dm: { policy: "open", allowFrom: ["*"], requireMention: false },
        threadReplies: "always",
        replyToMode: "all",
        groupPolicy: "open",
        groupAllowFrom: ["*"],
        groups: { 
          "*": { 
            requireMention: config.defaults.requireMention ?? true,
            systemPrompt: systemPrompt || defaultSystemPrompt(agent)
          } 
        },
        autoJoin: "always"
      }
    },
    gateway: {
      mode: "local",
      port: 20206
    }
  };
}
