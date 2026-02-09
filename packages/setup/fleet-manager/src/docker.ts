import Docker from 'dockerode';
import { Orchestrator, AgentSpec, AgentHandle } from './orchestrator.js';

export class DockerOrchestrator implements Orchestrator {
  private docker: Docker;
  private network: string;
  private hostRoot: string;

  constructor(network = 'local_fleet', hostRoot?: string) {
    this.docker = new Docker();
    this.network = network;
    this.hostRoot = hostRoot || process.cwd();
  }

  async startAgent(spec: AgentSpec): Promise<AgentHandle> {
    // Convert container paths to host paths
    const hostWorkspace = spec.workspacePath.replace(/^\/app/, this.hostRoot);
    const hostRuntime = spec.runtimePath.replace(/^\/app/, this.hostRoot);
    const hostHome = process.env.HOST_HOME;

    const container = await this.docker.createContainer({
      Image: 'openclaw-agent:latest',
      name: `agent-${spec.matrixId.replace(/[@:.]/g, '-')}`,
      Env: [
        `AGENT_MATRIX_ID=${spec.matrixId}`,
        `AGENT_PASSWORD=${spec.password}`,
        `MATRIX_HOMESERVER=${spec.homeserver}`,
        `FLEET_SECRET=${process.env.FLEET_SECRET || ''}`,
        `FLEET_SECRET_ARN=${process.env.FLEET_SECRET_ARN || ''}`,
        `AWS_REGION=${process.env.AWS_REGION || 'us-east-1'}`,
        `AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID || ''}`,
        `AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_ACCESS_KEY || ''}`,
        `AWS_SESSION_TOKEN=${process.env.AWS_SESSION_TOKEN || ''}`,
        `AWS_PROFILE=${process.env.AWS_PROFILE || ''}`,
        `AWS_SDK_LOAD_CONFIG=${process.env.AWS_SDK_LOAD_CONFIG || '1'}`,
      ],
      HostConfig: {
        Binds: [
          `${hostWorkspace}:/workspace:rw`,
          `${hostRuntime}:/runtime:rw`,
          ...(hostHome ? [`${hostHome}/.aws:/root/.aws:ro`] : []),
        ],
        NetworkMode: this.network,
      },
    });

    await container.start();
    return { matrixId: spec.matrixId, id: container.id };
  }

  async stopAgent(handle: AgentHandle): Promise<void> {
    const container = this.docker.getContainer(handle.id);
    await container.stop();
    await container.remove();
  }

  async listAgents(): Promise<AgentHandle[]> {
    const containers = await this.docker.listContainers({
      filters: { name: ['agent-'] },
    });
    return containers.map((c) => ({
      matrixId: c.Names[0]?.replace('/agent-', '@').replace(/-/g, '.') || '',
      id: c.Id,
    }));
  }
}
