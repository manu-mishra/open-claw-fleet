export interface AgentSpec {
  matrixId: string;
  workspacePath: string;
  runtimePath: string;
  password: string;
  homeserver: string;
}

export type StartAgentParams = AgentSpec;

export interface AgentHandle {
  matrixId: string;
  id: string; // containerId or taskArn
}

export interface Orchestrator {
  startAgent(spec: StartAgentParams): Promise<AgentHandle>;
  stopAgent(handle: AgentHandle): Promise<void>;
  listAgents(): Promise<AgentHandle[]>;
}
