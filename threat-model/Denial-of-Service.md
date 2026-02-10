# Denial of Service Threats

> **Category:** Availability threats  
> **Last Updated:** 2026-02-07

Denial of Service threats involve denying or degrading service to legitimate users. In Open-Claw-Fleet, this concerns resource exhaustion, service availability, and system stability.

---

## DOS-001

### Agent Task Exhaustion

| Attribute | Value |
|-----------|-------|
| **Threat ID** | DOS-001 |
| **STRIDE Category** | Denial of Service |
| **Severity** | 🔴 High |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | High |

#### Description

Fleet Manager can spawn unlimited agent tasks on ECS. A misconfigured or malicious config.yaml could request deployment of excessive agents, exhausting ECS capacity and increasing costs.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Fleet Manager | `packages/setup/fleet-manager/src/index.ts` |
| ECS Orchestrator | `packages/setup/fleet-manager/src/ecs-orchestrator.ts` |
| Environment Stack | `packages/aws/infra/lib/stacks/environment-stack.ts` |

#### Attack Vector

1. Attacker modifies config.yaml to request 1000+ agents
2. Fleet Manager deploys all requested agents
3. ECS tasks consume all cluster capacity
4. AWS costs spike dramatically
5. Legitimate services may fail to scale

#### Current Configuration

```typescript
// packages/setup/fleet-manager/src/index.ts
// No limit on number of agents that can be deployed
const agentPaths = await this.findAgentDirs(workspacesDir);
console.log(`📊 Found ${agentPaths.length} agent(s) to deploy`);
// All agents are deployed without quota check
```

#### Resource Consumption

| Resource | Per Agent | 100 Agents |
|----------|-----------|------------|
| CPU | 1024 units | 102,400 units |
| Memory | 2048 MB | 204,800 MB |
| EFS Connections | 1 | 100 |
| Approx. Cost/hr | $0.05 | $5.00 |

#### Recommended Mitigations

1. **Agent quota**: Implement maximum agent limit in Fleet Manager
2. **ECS capacity providers**: Set max capacity on Fargate
3. **Service quotas**: Configure AWS service quota limits
4. **Cost alerts**: Set up AWS Budget alarms
5. **Config validation**: Validate agent count before deployment

#### Quota Implementation

```typescript
// Recommended addition to fleet-manager
const MAX_AGENTS = parseInt(process.env.MAX_AGENTS || '50', 10);
if (agentPaths.length > MAX_AGENTS) {
  console.error(`Agent count ${agentPaths.length} exceeds limit ${MAX_AGENTS}`);
  process.exit(1);
}
```

#### References

- `packages/setup/fleet-manager/src/index.ts:103-107`
- `packages/setup/fleet-manager/src/ecs-orchestrator.ts`
- `docs/ARCHITECTURE.md` - ECS Cluster section

---

## DOS-002

### EFS Storage Exhaustion

| Attribute | Value |
|-----------|-------|
| **Threat ID** | DOS-002 |
| **STRIDE Category** | Denial of Service |
| **Severity** | 🟠 Medium |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | Medium |

#### Description

Agents have unrestricted write access to EFS. An agent could fill up EFS storage with logs, memory files, or downloaded content, impacting all services using the shared filesystem.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| EFS Construct | `packages/aws/infra/lib/constructs/efs-construct.ts` |
| Agent Runtime | `packages/setup/agent-runtime/src/index.ts` |
| Conduit Database | `/var/lib/matrix-conduit/` |

#### Attack Vector

1. Compromised agent runs shell commands to create large files
2. Agent memory accumulates without cleanup
3. Conduit database grows without bounds
4. EFS throughput credits depleted
5. All services experience slowdown or failure

#### Current State

- No storage quotas per agent
- No automated cleanup of old data
- EFS uses burst throughput (credits can be exhausted)
- All services share single EFS filesystem

#### Storage Paths

| Path | Service | Risk |
|------|---------|------|
| `/data/workspaces/` | Agent memory | High growth |
| `/var/lib/matrix-conduit/` | Conduit DB | Medium growth |
| `/data/config/` | Config files | Low growth |

#### Recommended Mitigations

1. **Storage quotas**: Implement per-agent storage limits
2. **EFS Infrequent Access**: Move old data to IA tier automatically
3. **Lifecycle policies**: Auto-delete old workspace data
4. **Provisioned throughput**: Consider provisioned IOPS for production
5. **Monitoring**: Alert on EFS burst credit depletion
6. **Separate filesystems**: Use separate EFS per service type

#### References

- `packages/aws/infra/lib/constructs/efs-construct.ts`
- `docs/ARCHITECTURE.md` - Storage section

---

## DOS-003

### Matrix Message Flood

| Attribute | Value |
|-----------|-------|
| **Threat ID** | DOS-003 |
| **STRIDE Category** | Denial of Service |
| **Severity** | 🟠 Medium |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | Medium |

#### Description

Agents or malicious users could flood Matrix rooms with messages, overwhelming Conduit, consuming storage, and potentially causing feedback loops between agents.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Conduit Configuration | `docker-files/conduit.toml` |
| Agent Behaviors | `docs/findings/behaviors-to-avoid.md` |
| Agent Messaging | OpenClaw Matrix extension |

#### Attack Vector

1. Agent receives message triggering response
2. Agent response triggers another agent
3. Cascade of messages between agents
4. Conduit overwhelmed, database grows rapidly
5. All agent communications disrupted

#### Known Issues

From `docs/findings/require-mention.md`:
> Disabling `requireMention` causes agents to respond to all messages in group rooms, increasing noise and loop risk.

From `docs/findings/behaviors-to-avoid.md`:
> Delegating a task to the same agent without isolation or a clean output guard (leads to loops).

#### Current Configuration

```toml
# docker-files/conduit.toml
max_request_size = 20_000_000  # 20MB requests allowed
max_concurrent_requests = 100
```

#### Recommended Mitigations

1. **Rate limiting**: Implement message rate limits per user
2. **Loop detection**: Detect and break message loops
3. **Require mention**: Enforce `requireMention: true` in group rooms
4. **Message size limits**: Reduce `max_request_size`
5. **Circuit breaker**: Implement circuit breaker for runaway agents

#### References

- `docker-files/conduit.toml:10-11`
- `docs/findings/require-mention.md`
- `docs/findings/behaviors-to-avoid.md`

---

## DOS-004

### Docker Compose Resource Limits

| Attribute | Value |
|-----------|-------|
| **Threat ID** | DOS-004 |
| **STRIDE Category** | Denial of Service |
| **Severity** | 🟡 Low |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | Low |

#### Description

Docker Compose configuration does not specify resource limits, allowing containers to consume unlimited host resources in local development.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Docker Compose | `docker-files/docker-compose.yml` |

#### Configuration

```yaml
# docker-files/docker-compose.yml
# No resource limits specified for any service
services:
  conduit:
    image: matrixconduit/matrix-conduit:latest
    # No mem_limit, cpus, etc.
```

#### Mitigation Details

> ⚠️ **MITIGATED**: This docker-compose.yml is used exclusively for **local development** and is **NOT deployed to ECS/cloud environments**.

**Mitigation Notes:**
1. Docker Compose is only used for local development testing
2. Local development typically runs small number of containers
3. Developer can manually stop containers if resources exhausted
4. Production deployment uses ECS task definitions with explicit limits
5. Impact limited to developer workstation

#### Production Alternative

In AWS ECS deployment, resources are explicitly limited:

```typescript
// packages/aws/infra/lib/constructs/agent-task-construct.ts:78-87
this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
  cpu: config.cpu,         // 1024 units (1 vCPU)
  memoryLimitMiB: config.memory,  // 2048 MB
  // ...
});
```

ECS Fargate enforces these limits at the infrastructure level:
- CPU throttling when exceeding allocation
- OOMKill when exceeding memory limit
- Task termination on sustained resource abuse

#### References

- `docker-files/docker-compose.yml`
- `packages/aws/infra/lib/constructs/agent-task-construct.ts:78-87`
- `docs/ARCHITECTURE.md` - Task Sizing section
