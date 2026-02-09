import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
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

  // Write org.json
  if (!opts.dryRun) {
    await mkdir(opts.outputDir, { recursive: true });
    await writeFile(join(opts.outputDir, 'org.json'), JSON.stringify(org, null, 2));
  }
  console.log(`${opts.dryRun ? '[DRY RUN] ' : ''}Generated org.json (${org.people.length} people)`);

  // Build set of deployed IDs including CEO
  const deployedIds = new Set(agents.map(a => a.matrixId));
  if (config.ceo?.matrixId) deployedIds.add(config.ceo.matrixId);

  for (const agent of agents) {
    // Use sanitized matrix ID as directory name (matches ECS orchestrator)
    const agentDir = join(opts.outputDir, agent.department, agent.matrixId.replace(/[@:]/g, '').replace(config.matrix.domain, ''));

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

      // HEARTBEAT.md from shared
      const heartbeatTpl = await loadTemplate(opts.templatesDir, 'shared/HEARTBEAT.md');
      await writeFile(join(agentDir, 'HEARTBEAT.md'), render(heartbeatTpl, context));

      // Copy relevant skills
      await copySkills(agent.resolvedSkills, opts.templatesDir, agentDir);

      // openclaw.json
      await writeFile(join(agentDir, 'openclaw.json'), JSON.stringify(renderConfig(agent, config), null, 2));

      // Filtered org.json - CEO + deployed agents only
      const filteredPeople = org.people
        .filter(p => deployedIds.has(p.matrixId))
        .map(p => ({
          ...p,
          directReports: p.directReports.filter(id => deployedIds.has(id)),
          reportsTo: p.reportsTo && deployedIds.has(p.reportsTo) ? p.reportsTo : null
        }));
      
      const filteredOrg = { departments: org.departments, people: filteredPeople };
      await writeFile(join(agentDir, 'org.json'), JSON.stringify(filteredOrg, null, 2));
    }

    console.log(`${opts.dryRun ? '[DRY RUN] ' : ''}Generated ${agentDir}`);
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

async function copySkills(skills: string[], templatesDir: string, agentDir: string): Promise<void> {
  const skillsDir = join(agentDir, 'skills');
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

function renderConfig(agent: SelectedAgent, config: FleetConfig): object {
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
      load: {
        paths: ["/opt/plugins/people/people.js"]
      },
      entries: {
        matrix: { enabled: true },
        people: { enabled: true }
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
            systemPrompt: `You are ${agent.name}, ${agent.title} at AnyCompany Corp. Stay in character. ALWAYS use the "people" tool for org lookups (names, managers, reports, headcount). If the tool is unavailable or returns no results, say so clearly and do not guess. For direct messages, use "message" with channel=matrix and target "@first.last:anycompany.corp". Use #all-employees:anycompany.corp only for broadcast updates. In group rooms, reply in threads (use reply metadata or threadId when sending via tool).

Respond/ignore rules:
- Respond when a message directly requests your input, assigns you work, or mentions you by name/role.
- Respond to CEO and manager directives promptly, even in group rooms.
- If a message is FYI/status with no action for you, do not reply; react with a simple acknowledgement (e.g. ✅) instead.
- If a message is between others and does not need you, do not respond.
- If unclear whether action is needed, ask one concise clarification question in the same room.
- Never include reasoning, analysis, or tool traces in any reply. Output only the final answer.
- Never delegate or call sessions_spawn unless explicitly instructed by the CEO.
- Never output tags like <analysis>, <reasoning>, or role tokens.

Agent communication protocol (agent-to-agent messages):
- Prefix every outgoing agent-to-agent message with one of: [REQUEST], [INFORM], [COMPLETE], [ACK].
- Always respond to [REQUEST]. Do not respond to [INFORM], [COMPLETE], or [ACK] unless clarification is required.
- End task updates with [COMPLETE] when your work is done.
- When responding to an agent-to-agent request, return only the final answer (no reasoning, no preamble).
- When responding to an agent-to-agent request, return only the final answer (no reasoning, no preamble).`
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
