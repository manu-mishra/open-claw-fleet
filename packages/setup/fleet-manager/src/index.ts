import { watch, FSWatcher } from 'chokidar';
import { join, resolve, basename } from 'path';
import { mkdir, readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import crypto from 'crypto';
import http from 'http';
import { loadConfig } from './config.js';
import { generateOrg, Org } from './org.js';
import { resolveAgents, SelectedAgent } from './resolver.js';
import { generateWorkspaces } from './generator.js';
import { Orchestrator, AgentHandle } from './orchestrator.js';
import { DockerOrchestrator } from './docker.js';
import { EcsOrchestrator } from './ecs-orchestrator.js';

export { Orchestrator, AgentHandle, AgentSpec } from './orchestrator.js';
export { DockerOrchestrator } from './docker.js';
export { EcsOrchestrator } from './ecs-orchestrator.js';

export class FleetManager {
  private orchestrator: Orchestrator;
  private watcher?: FSWatcher;
  private env: string;
  private envDir: string;
  private templatesDir: string;
  private fleetSecret: string;
  private running = new Map<string, AgentHandle>();

  constructor(env: string, fleetSecret: string, orchestrator?: Orchestrator) {
    const hostRoot = process.env.HOST_ROOT || process.cwd();
    
    // Auto-detect orchestrator based on environment
    if (!orchestrator) {
      if (env === 'aws' || process.env.ORCHESTRATOR === 'ecs') {
        // ECS orchestrator for AWS
        const ecsConfig = {
          clusterArn: process.env.ECS_CLUSTER_ARN!,
          taskDefinitionArn: process.env.ECS_TASK_DEFINITION_ARN!,
          subnets: process.env.ECS_SUBNETS!.split(','),
          securityGroups: process.env.ECS_SECURITY_GROUPS!.split(','),
          fileSystemId: process.env.EFS_FILE_SYSTEM_ID!,
          fleetSecretArn: process.env.FLEET_SECRET_ARN!,
          ceoSecretArn: process.env.CEO_SECRET_ARN!,
          region: process.env.AWS_REGION || 'us-east-1',
        };
        orchestrator = new EcsOrchestrator(ecsConfig);
      } else {
        // Docker orchestrator for local
        orchestrator = new DockerOrchestrator('local_fleet', hostRoot);
      }
    }
    
    if (!orchestrator) {
      throw new Error('Orchestrator not initialized');
    }
    
    this.orchestrator = orchestrator;
    this.env = env;
    
    // For AWS, use EFS paths
    if (env === 'aws') {
      this.envDir = '/data/config/environments/aws';
      this.templatesDir = '/data/config/templates';
    } else {
      this.envDir = resolve('config/environments', env);
      this.templatesDir = resolve('config/templates');
    }
    
    this.fleetSecret = fleetSecret;
  }

  async generate(force = false): Promise<SelectedAgent[]> {
    const configPath = join(this.envDir, 'config.yaml');
    // For AWS, write workspaces directly to /data/workspaces for agent access
    const outputDir = this.env === 'aws' ? '/data/workspaces' : join(this.envDir, 'workspaces');
    const orgPath = join(outputDir, 'org.json');

    const config = await loadConfig(configPath);
    
    // Reuse existing org.json unless forced
    let org: Org;
    if (!force && existsSync(orgPath)) {
      org = JSON.parse(await readFile(orgPath, 'utf-8'));
      console.log(`Using existing org.json (${org.people.length} people)`);
    } else {
      org = generateOrg(config.matrix.domain, 42, config.ceo);
    }
    
    const agents = resolveAgents(config, org);

    await generateWorkspaces(config, org, agents, { outputDir, templatesDir: this.templatesDir });
    console.log(`Generated ${agents.length} agent workspaces`);
    return agents;
  }

  async deploy(): Promise<void> {
    console.log('📦 Starting deployment...');
    
    const workspacesDir = this.env === 'aws' ? '/data/workspaces' : join(this.envDir, 'workspaces');
    const runtimeDir = join(this.envDir, 'runtime');
    const config = await loadConfig(join(this.envDir, 'config.yaml'));
    
    console.log(`🔍 Looking for agents in: ${workspacesDir}`);
    const agentPaths = await this.findAgentDirs(workspacesDir);
    console.log(`📊 Found ${agentPaths.length} agent(s) to deploy`);
    if (agentPaths.length > 0) {
      console.log(`   Agents: ${agentPaths.map(p => basename(p)).join(', ')}`);
    }

    // Wait for Conduit to be ready (max 60 seconds)
    console.log('⏳ Waiting for Conduit to be ready...');
    await this.waitForConduit(config.matrix.homeserver, 60000);
    console.log('✅ Conduit is ready');

    // Setup Matrix rooms - fail if this fails
    console.log('🏠 Setting up Matrix rooms...');
    await this.setupMatrixRooms(config.matrix.homeserver, config.matrix.domain, workspacesDir);
    console.log('✅ Matrix rooms configured');

    if (agentPaths.length === 0) {
      console.log('ℹ️  No agents to start');
    } else {
      console.log(`🚀 Starting ${agentPaths.length} agent(s)...`);
    }

    for (const agentPath of agentPaths) {
      const agentName = agentPath.split('/').pop()!;
      const dept = agentPath.split('/').slice(-2, -1)[0];
      const matrixId = `@${agentName}:${config.matrix.domain}`;
      const runtimePath = join(runtimeDir, dept, agentName);

      await mkdir(runtimePath, { recursive: true });
      await this.startAgent(matrixId, agentPath, runtimePath, config.matrix.homeserver);
    }

    console.log('✅ Deployment complete');
  }

  private async waitForConduit(homeserver: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this.matrixRequest(homeserver, 'GET', '/_matrix/client/versions');
        return; // Success
      } catch {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s between retries
      }
    }
    throw new Error(`Conduit not ready after ${timeoutMs}ms - deployment aborted`);
  }

  private async setupMatrixRooms(homeserver: string, domain: string, workspacesDir: string): Promise<void> {
    const configPath = join(this.envDir, 'config.yaml');
    const config = await loadConfig(configPath);
    
    if (!config.ceo?.matrixId) {
      console.log('ℹ️  No CEO configured, skipping room setup');
      return;
    }

    const orgPath = join(workspacesDir, 'org.json');
    if (!existsSync(orgPath)) return;

    const org = JSON.parse(await readFile(orgPath, 'utf-8'));
    
    // Get deployed agent IDs from workspace directories
    const deployedIds = new Set<string>([config.ceo.matrixId]);
    const agentDirs = await this.findAgentDirs(workspacesDir);
    for (const dir of agentDirs) {
      const agentName = dir.split('/').pop()!;
      deployedIds.add(`@${agentName}:${domain}`);
    }
    
    // Filter org to deployed people only
    const deployedPeople = org.people.filter((p: any) => deployedIds.has(p.matrixId));

    // Register CEO first and use their token to create rooms
    console.log(`🔐 Registering CEO: ${config.ceo.matrixId}`);
    const ceoToken = await this.getMatrixToken(homeserver, config.ceo.matrixId, true);
    if (!ceoToken) {
      console.log('❌ Failed to get CEO token');
      return;
    }

    // Only create rooms that have deployed members
    const rooms: string[] = [];
    
    if (deployedPeople.length > 0) {
      rooms.push('all-employees');
    }
    
    // Department leadership rooms - only if VP is deployed
    const deployedDepts = new Set(deployedPeople.filter((p: any) => p.level === 'VP').map((p: any) => p.department));
    for (const dept of deployedDepts) {
      rooms.push(`${(dept as string).toLowerCase().replace(/\s+/g, '-')}-leadership`);
    }

    // Team rooms - only if team has deployed members
    const deployedTeams = new Set(deployedPeople.filter((p: any) => p.team).map((p: any) => p.team));
    for (const team of deployedTeams) {
      rooms.push(`${(team as string).toLowerCase().replace(/\s+/g, '-')}-team`);
    }

    // Create rooms using CEO token
    console.log(`🏠 Creating ${rooms.length} room(s)...`);
    for (const alias of rooms) {
      await this.createRoom(homeserver, ceoToken, alias, alias.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), domain);
    }

    console.log(`🤝 Setting up direct rooms...`);
    await this.setupDirectRooms(homeserver, deployedPeople);

    console.log(`✅ CEO ${config.ceo.matrixId} joined ${rooms.length} room(s)`);
  }

  private async joinRoom(homeserver: string, token: string, alias: string, domain: string): Promise<void> {
    try {
      await this.matrixRequest(homeserver, 'POST', `/_matrix/client/r0/join/${encodeURIComponent(`#${alias}:${domain}`)}`, {}, token);
    } catch {}
  }

  private async joinRoomById(homeserver: string, token: string, roomId: string): Promise<void> {
    try {
      await this.matrixRequest(homeserver, 'POST', `/_matrix/client/r0/join/${encodeURIComponent(roomId)}`, {}, token);
    } catch {}
  }

  private async listJoinedRooms(homeserver: string, token: string): Promise<string[]> {
    try {
      const res = await this.matrixRequest(homeserver, 'GET', '/_matrix/client/r0/joined_rooms', undefined, token);
      return Array.isArray(res?.joined_rooms) ? res.joined_rooms : [];
    } catch {
      return [];
    }
  }

  private async listJoinedRoomMembers(homeserver: string, token: string, roomId: string): Promise<string[]> {
    try {
      const res = await this.matrixRequest(homeserver, 'GET', `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/joined_members`, undefined, token);
      return res?.joined ? Object.keys(res.joined) : [];
    } catch {
      return [];
    }
  }

  private async findDirectRoom(homeserver: string, token: string, targetId: string): Promise<string | null> {
    const rooms = await this.listJoinedRooms(homeserver, token);
    for (const roomId of rooms) {
      const members = await this.listJoinedRoomMembers(homeserver, token, roomId);
      if (members.length === 2 && members.includes(targetId)) {
        return roomId;
      }
    }
    return null;
  }

  private async getDirectAccountData(homeserver: string, token: string, userId: string): Promise<Record<string, string[]>> {
    try {
      const res = await this.matrixRequest(homeserver, 'GET', `/_matrix/client/r0/user/${encodeURIComponent(userId)}/account_data/m.direct`, undefined, token);
      if (res && typeof res === 'object' && !Array.isArray(res)) return res as Record<string, string[]>;
    } catch {}
    return {};
  }

  private async setDirectAccountData(homeserver: string, token: string, userId: string, data: Record<string, string[]>): Promise<void> {
    await this.matrixRequest(homeserver, 'PUT', `/_matrix/client/r0/user/${encodeURIComponent(userId)}/account_data/m.direct`, data, token);
  }

  private async ensureDirectMapping(homeserver: string, token: string, userId: string, targetId: string, roomId: string): Promise<void> {
    const current = await this.getDirectAccountData(homeserver, token, userId);
    const existing = Array.isArray(current[targetId]) ? current[targetId] : [];
    if (existing.includes(roomId)) return;
    const updated: Record<string, string[]> = {
      ...current,
      [targetId]: [roomId, ...existing.filter((id) => id !== roomId)],
    };
    await this.setDirectAccountData(homeserver, token, userId, updated);
  }

  private async ensureDirectRoom(homeserver: string, creatorId: string, targetId: string): Promise<string | null> {
    if (!creatorId || !targetId || creatorId === targetId) return null;
    const creatorToken = await this.getMatrixToken(homeserver, creatorId);
    if (!creatorToken) return null;
    const existing = await this.findDirectRoom(homeserver, creatorToken, targetId);
    if (existing) return existing;
    try {
      const res = await this.matrixRequest(homeserver, 'POST', '/_matrix/client/r0/createRoom', {
        invite: [targetId],
        is_direct: true,
        preset: 'trusted_private_chat'
      }, creatorToken);
      const roomId = res?.room_id;
      if (!roomId) return null;
      const targetToken = await this.getMatrixToken(homeserver, targetId);
      if (targetToken) {
        await this.joinRoomById(homeserver, targetToken, roomId);
      }
      return roomId;
    } catch {}
    return null;
  }

  private async setupDirectRooms(homeserver: string, deployedPeople: any[]): Promise<void> {
    const deployedIds = new Set<string>(deployedPeople.map((p: any) => p.matrixId));
    const pairs = new Set<string>();
    const addPair = (a: string, b: string): void => {
      if (!a || !b || a === b) return;
      const key = [a, b].sort().join('|');
      if (pairs.has(key)) return;
      pairs.add(key);
    };

    // Manager <-> direct report pairs
    for (const person of deployedPeople) {
      const manager = person?.reportsTo;
      if (!manager || !deployedIds.has(manager)) continue;
      addPair(String(person.matrixId), String(manager));
    }

    // Peer pairs: same manager (direct report peers)
    const peersByManager = new Map<string, string[]>();
    for (const person of deployedPeople) {
      const manager = person?.reportsTo;
      if (!manager || !deployedIds.has(manager)) continue;
      const list = peersByManager.get(manager) ?? [];
      list.push(String(person.matrixId));
      peersByManager.set(manager, list);
    }
    for (const reports of peersByManager.values()) {
      for (let i = 0; i < reports.length; i++) {
        for (let j = i + 1; j < reports.length; j++) {
          addPair(reports[i], reports[j]);
        }
      }
    }

    // Peer pairs: same team (if team defined)
    const peersByTeam = new Map<string, string[]>();
    for (const person of deployedPeople) {
      if (!person?.team) continue;
      const key = `${String(person.department || '')}::${String(person.team)}`;
      const list = peersByTeam.get(key) ?? [];
      list.push(String(person.matrixId));
      peersByTeam.set(key, list);
    }
    for (const teamMembers of peersByTeam.values()) {
      for (let i = 0; i < teamMembers.length; i++) {
        for (let j = i + 1; j < teamMembers.length; j++) {
          addPair(teamMembers[i], teamMembers[j]);
        }
      }
    }

    for (const key of pairs) {
      const [a, b] = key.split('|');
      const roomId = await this.ensureDirectRoom(homeserver, a, b);
      if (!roomId) continue;
      const aToken = await this.getMatrixToken(homeserver, a);
      if (aToken) {
        await this.ensureDirectMapping(homeserver, aToken, a, b, roomId);
      }
      const bToken = await this.getMatrixToken(homeserver, b);
      if (bToken) {
        await this.ensureDirectMapping(homeserver, bToken, b, a, roomId);
      }
    }
    if (pairs.size > 0) {
      console.log(`Ensured ${pairs.size} direct rooms`);
    }
  }

  private async getMatrixToken(homeserver: string, matrixId: string, isCeo: boolean = false): Promise<string | null> {
    const username = matrixId.split(':')[0].slice(1);
    const password = this.derivePassword(matrixId);

    let justRegistered = false;
    try {
      // Register
      await this.matrixRequest(homeserver, 'POST', '/_matrix/client/r0/register', {
        username, password, auth: { type: 'm.login.dummy' }
      });
      console.log(`Registered ${matrixId}`);
      justRegistered = true;
    } catch (e: any) {
      // User may already exist
      console.log(`Register ${matrixId}: ${e.errcode || 'ok'}`);
    }

    try {
      const res = await this.matrixRequest(homeserver, 'POST', '/_matrix/client/r0/login', {
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username },
        password,
      });
      
      // Update secret if this is the CEO (on first registration or if secret is still placeholder)
      if (this.env === 'aws' && isCeo && justRegistered) {
        await this.updateCeoSecret(username, password);
      }
      
      return res.access_token;
    } catch (e: any) {
      console.log(`Login failed for ${matrixId}: ${e.error || e}`);
      return null;
    }
  }

  private async updateCeoSecret(username: string, password: string): Promise<void> {
    if (!process.env.CEO_SECRET_ARN) return;
    
    try {
      const { SecretsManagerClient, UpdateSecretCommand } = await import('@aws-sdk/client-secrets-manager');
      const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
      
      await client.send(new UpdateSecretCommand({
        SecretId: process.env.CEO_SECRET_ARN,
        SecretString: JSON.stringify({ username, password }),
      }));
      
      console.log('✅ Updated CEO secret in Secrets Manager');
    } catch (error) {
      console.log('⚠️  Failed to update CEO secret:', error);
    }
  }

  private async createRoom(homeserver: string, token: string, alias: string, name: string, domain: string): Promise<void> {
    try {
      await this.matrixRequest(homeserver, 'POST', '/_matrix/client/r0/createRoom', {
        name, room_alias_name: alias, preset: 'public_chat'
      }, token);
      console.log(`Created #${alias}:${domain}`);
    } catch {
      // Room exists
    }
  }

  private matrixRequest(homeserver: string, method: string, path: string, body?: object, token?: string): Promise<any> {
    const url = new URL(path, homeserver);
    return new Promise((resolve, reject) => {
      const req = http.request(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) reject(parsed);
          else resolve(parsed);
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  private async findAgentDirs(workspacesDir: string): Promise<string[]> {
    const agents: string[] = [];
    if (!existsSync(workspacesDir)) return agents;

    for (const dept of await readdir(workspacesDir, { withFileTypes: true })) {
      if (!dept.isDirectory() || dept.name === 'org.json') continue;
      for (const agent of await readdir(join(workspacesDir, dept.name), { withFileTypes: true })) {
        if (agent.isDirectory()) agents.push(join(workspacesDir, dept.name, agent.name));
      }
    }
    return agents;
  }

  private async startAgent(matrixId: string, workspacePath: string, runtimePath: string, homeserver: string): Promise<void> {
    if (this.running.has(matrixId)) return;

    try {
      const handle = await this.orchestrator.startAgent({
        matrixId,
        workspacePath,
        runtimePath,
        password: this.derivePassword(matrixId),
        homeserver,
      });
      this.running.set(matrixId, handle);
      console.log(`Started ${matrixId}`);
    } catch (err: any) {
      console.error(`Failed to start ${matrixId}: ${err.message}`);
    }
  }

  private async stopAgent(matrixId: string): Promise<void> {
    const handle = this.running.get(matrixId);
    if (!handle) return;

    try {
      await this.orchestrator.stopAgent(handle);
      this.running.delete(matrixId);
      console.log(`Stopped ${matrixId}`);
    } catch (err: any) {
      console.error(`Failed to stop ${matrixId}: ${err.message}`);
    }
  }

  private derivePassword(matrixId: string): string {
    const password = crypto.createHmac('sha256', this.fleetSecret).update(matrixId).digest('hex').slice(0, 32);
    console.log(`Derived password for ${matrixId}: ${password.slice(0, 8)}... (secret starts with: ${this.fleetSecret.slice(0, 4)}...)`);
    return password;
  }

  async stop(): Promise<void> {
    for (const matrixId of this.running.keys()) await this.stopAgent(matrixId);
    this.watcher?.close();
  }

  status(): AgentHandle[] {
    return Array.from(this.running.values());
  }

  async watch(): Promise<void> {
    const configPath = join(this.envDir, 'config.yaml');
    this.watcher = watch(configPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500 },
    });

    this.watcher.on('change', async () => {
      const previous = new Set(this.running.keys());
      await this.generate();

      const config = await loadConfig(configPath);
      const currentPaths = await this.findAgentDirs(join(this.envDir, 'workspaces'));
      const current = new Set(currentPaths.map(p => `@${p.split('/').pop()}:${config.matrix.domain}`));

      for (const id of previous) if (!current.has(id)) await this.stopAgent(id);
      for (const path of currentPaths) {
        const matrixId = `@${path.split('/').pop()}:${config.matrix.domain}`;
        if (!previous.has(matrixId)) {
          const dept = path.split('/').slice(-2, -1)[0];
          await mkdir(join(this.envDir, 'runtime', dept, path.split('/').pop()!), { recursive: true });
          await this.startAgent(matrixId, path, join(this.envDir, 'runtime', dept, path.split('/').pop()!), config.matrix.homeserver);
        }
      }
    });
  }

  async start(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════');
    console.log(`🦞 Fleet Manager starting for env: ${this.env}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    
    await this.generate();
    await this.deploy();
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('👀 Watching for config changes...');
    console.log('Press Ctrl+C to stop');
    console.log('═══════════════════════════════════════════════════════');
    
    await this.watch();
  }
}
