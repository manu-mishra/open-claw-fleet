import { ECSClient, RunTaskCommand, StopTaskCommand, DescribeTasksCommand, ListTasksCommand } from '@aws-sdk/client-ecs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
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
}

export class EcsOrchestrator implements Orchestrator {
  private ecs: ECSClient;
  private secrets: SecretsManagerClient;
  private config: EcsOrchestratorConfig;

  constructor(config: EcsOrchestratorConfig) {
    this.config = config;
    this.ecs = new ECSClient({ region: config.region });
    this.secrets = new SecretsManagerClient({ region: config.region });
  }

  async startAgent(params: StartAgentParams): Promise<AgentHandle> {
    const { matrixId, homeserver } = params;
    
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
    
    // Run ECS task - use workspace/runtime paths passed from deploy()
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
          environment: [
            { name: 'AGENT_MATRIX_ID', value: matrixId },
            { name: 'MATRIX_HOMESERVER', value: homeserver },
            { name: 'WORKSPACE_PATH', value: params.workspacePath },
            { name: 'RUNTIME_PATH', value: params.runtimePath },
            { name: 'FLEET_SECRET_ARN', value: this.config.fleetSecretArn },
          ],
        }],
      },
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
