import { ECSClient, RunTaskCommand, StopTaskCommand, DescribeTasksCommand, ListTasksCommand } from '@aws-sdk/client-ecs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { EFSClient, CreateAccessPointCommand, DescribeAccessPointsCommand, DeleteAccessPointCommand } from '@aws-sdk/client-efs';
import type { AgentHandle, Orchestrator, StartAgentParams } from './orchestrator.js';

export interface EcsOrchestratorConfig {
  clusterArn: string;
  taskDefinitionArn: string;
  subnets: string[];
  securityGroups: string[];
  fileSystemId: string;
  fleetSecretArn: string;
  ceoSecretArn: string;
  region: string;
  matrixDomain?: string;
  commandCenterUrl?: string;
  commandCenterApiToken?: string;
}

export class EcsOrchestrator implements Orchestrator {
  private ecs: ECSClient;
  private secrets: SecretsManagerClient;
  private efs: EFSClient;
  private config: EcsOrchestratorConfig;
  private accessPointCache = new Map<string, string>(); // matrixId -> accessPointId

  constructor(config: EcsOrchestratorConfig) {
    this.config = config;
    this.ecs = new ECSClient({ region: config.region });
    this.secrets = new SecretsManagerClient({ region: config.region });
    this.efs = new EFSClient({ region: config.region });
  }

  async startAgent(params: StartAgentParams): Promise<AgentHandle> {
    const { matrixId, homeserver, workspacePath } = params;
    
    // Get fleet secret for password derivation
    const fleetSecretData = await this.secrets.send(new GetSecretValueCommand({
      SecretId: this.config.fleetSecretArn,
    }));
    const fleetSecret = JSON.parse(fleetSecretData.SecretString!).secret;
    
    // Derive password using fleet secret (deterministic)
    const crypto = await import('crypto');
    const derivedPassword = crypto.createHmac('sha256', fleetSecret)
      .update(matrixId)
      .digest('hex')
      .slice(0, 32);
    
    // Create or get access point for this agent
    const accessPointId = await this.ensureAccessPoint(matrixId, workspacePath);
    
    // Run ECS task with access point isolation
    const environmentOverrides = [
      { name: 'AGENT_MATRIX_ID', value: matrixId },
      { name: 'MATRIX_HOMESERVER', value: homeserver },
      { name: 'MATRIX_DOMAIN', value: this.config.matrixDomain || 'anycompany.corp' },
      { name: 'WORKSPACE_PATH', value: '/workspace' }, // Now isolated via access point
      { name: 'AGENT_SHARED_ROOT', value: '/shared' },
      { name: 'RUNTIME_PATH', value: params.runtimePath },
      { name: 'FLEET_SECRET_ARN', value: this.config.fleetSecretArn },
      ...(this.config.commandCenterUrl
        ? [{ name: 'COMMAND_CENTER_URL', value: this.config.commandCenterUrl }]
        : []),
      ...(this.config.commandCenterApiToken
        ? [{ name: 'COMMAND_CENTER_API_TOKEN', value: this.config.commandCenterApiToken }]
        : []),
    ];

    const result = await this.ecs.send(new RunTaskCommand({
      cluster: this.config.clusterArn,
      taskDefinition: this.config.taskDefinitionArn,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: this.config.subnets,
          securityGroups: this.config.securityGroups,
          assignPublicIp: 'DISABLED',
        },
      },
      overrides: {
        containerOverrides: [{
          name: 'agent',
          environment: environmentOverrides,
        }],
        // Override volume to use access point
        taskRoleArn: undefined, // Use task definition role
        executionRoleArn: undefined, // Use task definition execution role
      },
      // Note: Access point must be configured in task definition volume
      // We pass the access point ID via tags for reference
      tags: [
        { key: 'AgentId', value: matrixId },
        { key: 'AccessPointId', value: accessPointId },
      ],
    }));

    // Check for failures
    if (result.failures && result.failures.length > 0) {
      const failure = result.failures[0];
      throw new Error(`Failed to start task: ${failure.reason} - ${failure.detail}`);
    }

    const taskArn = result.tasks?.[0]?.taskArn;
    if (!taskArn) throw new Error('Failed to start task - no task ARN returned');

    console.log(`✅ Started task: ${taskArn}`);
    return { id: taskArn, matrixId };
  }

  /**
   * Ensure access point exists for agent, creating if needed
   */
  private async ensureAccessPoint(matrixId: string, workspacePath: string): Promise<string> {
    // Check cache first
    if (this.accessPointCache.has(matrixId)) {
      return this.accessPointCache.get(matrixId)!;
    }

    // Sanitize matrix ID for tagging
    const sanitizedId = matrixId.replace(/[@:]/g, '').replace('.anycompany.corp', '');
    
    try {
      // Check if access point already exists
      const existing = await this.efs.send(new DescribeAccessPointsCommand({
        FileSystemId: this.config.fileSystemId,
      }));

      const found = existing.AccessPoints?.find(ap => 
        ap.Tags?.some(t => t.Key === 'AgentId' && t.Value === sanitizedId)
      );

      if (found?.AccessPointId) {
        console.log(`✅ Using existing access point: ${found.AccessPointId} for ${matrixId}`);
        this.accessPointCache.set(matrixId, found.AccessPointId);
        return found.AccessPointId;
      }
    } catch (err: any) {
      console.warn(`⚠️  Failed to check existing access points: ${err.message}`);
    }

    // Create new access point
    // Extract path relative to EFS root (remove /data prefix)
    const efsPath = workspacePath.replace('/data', '');
    
    console.log(`🔧 Creating access point for ${matrixId} at ${efsPath}`);
    
    const result = await this.efs.send(new CreateAccessPointCommand({
      FileSystemId: this.config.fileSystemId,
      PosixUser: {
        Uid: 1000,
        Gid: 1000,
      },
      RootDirectory: {
        Path: efsPath,
        CreationInfo: {
          OwnerUid: 1000,
          OwnerGid: 1000,
          Permissions: '755',
        },
      },
      Tags: [
        { Key: 'AgentId', Value: sanitizedId },
        { Key: 'MatrixId', Value: matrixId },
        { Key: 'ManagedBy', Value: 'fleet-manager' },
        { Key: 'CreatedAt', Value: new Date().toISOString() },
      ],
    }));

    const accessPointId = result.AccessPointId!;
    console.log(`✅ Created access point: ${accessPointId} for ${matrixId}`);
    
    this.accessPointCache.set(matrixId, accessPointId);
    return accessPointId;
  }

  async stopAgent(handle: AgentHandle): Promise<void> {
    await this.ecs.send(new StopTaskCommand({
      cluster: this.config.clusterArn,
      task: handle.id,
    }));
  }

  async listAgents(): Promise<AgentHandle[]> {
    const result = await this.ecs.send(new ListTasksCommand({
      cluster: this.config.clusterArn,
      desiredStatus: 'RUNNING',
    }));

    if (!result.taskArns?.length) return [];

    const tasks = await this.ecs.send(new DescribeTasksCommand({
      cluster: this.config.clusterArn,
      tasks: result.taskArns,
    }));

    return tasks.tasks?.map(task => {
      const matrixId = task.overrides?.containerOverrides?.[0]?.environment?.find(e => e.name === 'AGENT_MATRIX_ID')?.value || 'unknown';
      return { id: task.taskArn!, matrixId };
    }) || [];
  }
}
