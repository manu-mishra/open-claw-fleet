# Elevation of Privilege Threats

> **Category:** Authorization threats  
> **Last Updated:** 2026-02-07

Elevation of Privilege threats involve gaining capabilities without proper authorization. In Open-Claw-Fleet, this concerns IAM permissions, container isolation, and agent tool execution.

---

## EOP-001

### Overly Permissive IAM Policies

| Attribute | Value |
|-----------|-------|
| **Threat ID** | EOP-001 |
| **STRIDE Category** | Elevation of Privilege |
| **Severity** | 🔴 High |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | High |

#### Description

IAM policies for agent and Fleet Manager task roles use wildcards and broad permissions that exceed the principle of least privilege. Compromised tasks could access resources beyond their intended scope.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Agent Task Construct | `packages/aws/infra/lib/constructs/agent-task-construct.ts` |
| Fleet Manager Construct | `packages/aws/infra/lib/constructs/fleet-manager-service-construct.ts` |

#### Overly Permissive Policies

**Agent Task Role:**
```typescript
// packages/aws/infra/lib/constructs/agent-task-construct.ts:47-50
this.taskRole.addToPolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
  resources: ['*'],  // All Bedrock models - too broad
}));
```

**Fleet Manager Task Role:**
```typescript
// packages/aws/infra/lib/constructs/fleet-manager-service-construct.ts:62-69
taskRole.addToPolicy(new iam.PolicyStatement({
  actions: ['iam:PassRole'],
  resources: ['*'],  // Can pass any role - too broad
  conditions: {
    StringEquals: {
      'iam:PassedToService': 'ecs-tasks.amazonaws.com',
    },
  },
}));
```

#### Risk Analysis

| Policy | Current | Risk | Recommended |
|--------|---------|------|-------------|
| Bedrock access | `*` | Can invoke any model | Specific model ARNs |
| PassRole | `*` | Can pass any ECS role | Specific task role ARN |
| Secrets | Pattern match | Acceptable | - |
| EFS | Filesystem ARN | Acceptable | - |

#### Recommended Mitigations

1. **Specific model ARNs**: Restrict Bedrock to approved models only
2. **Specific role ARNs**: Restrict PassRole to agent task role only
3. **Resource tags**: Use tag-based conditions where possible
4. **IAM Access Analyzer**: Run analyzer to identify unused permissions
5. **Permission boundaries**: Implement permission boundaries

#### Least Privilege Example

```typescript
// Restrict Bedrock to specific models
this.taskRole.addToPolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-*',
    'arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-*',
  ],
}));

// Restrict PassRole to specific role
taskRole.addToPolicy(new iam.PolicyStatement({
  actions: ['iam:PassRole'],
  resources: [agentTaskRole.roleArn],  // Specific role only
}));
```

#### References

- `packages/aws/infra/lib/constructs/agent-task-construct.ts:47-50`
- `packages/aws/infra/lib/constructs/fleet-manager-service-construct.ts:62-69`
- `docs/ARCHITECTURE.md` - IAM Roles & Policies section

---

## EOP-002

### Container Escape

| Attribute | Value |
|-----------|-------|
| **Threat ID** | EOP-002 |
| **STRIDE Category** | Elevation of Privilege |
| **Severity** | 🟠 Medium |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | High |

#### Description

An attacker who compromises an agent container could attempt to escape the container and access the underlying host or other containers.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Agent Task Definition | `packages/aws/infra/lib/constructs/agent-task-construct.ts` |
| ECS Cluster | `packages/aws/infra/lib/constructs/cluster-construct.ts` |

#### Mitigation Details

AWS Fargate provides strong container isolation by design:

1. **No shared kernel**: Each task runs on dedicated microVM
2. **Firecracker isolation**: AWS Firecracker provides kernel-level isolation
3. **No host access**: No access to underlying EC2 instance
4. **Network isolation**: VPC networking prevents cross-task communication

```typescript
// packages/aws/infra/lib/constructs/agent-task-construct.ts:78-87
this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
  // Fargate launch type - no EC2 host access
  runtimePlatform: {
    cpuArchitecture: ecs.CpuArchitecture.ARM64,
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
  },
});
```

#### Fargate Security Features

| Feature | Benefit |
|---------|---------|
| Firecracker microVM | Kernel-level isolation |
| Dedicated kernel | No shared resources |
| No privileged mode | Cannot request privileged containers |
| No host network | Isolated VPC networking |
| IAM task roles | Scoped credentials |

#### Additional Considerations

- Fargate platform version 1.4.0+ recommended
- Container image scanning should be enabled
- Avoid mounting sensitive host paths

#### References

- `packages/aws/infra/lib/constructs/agent-task-construct.ts:78-87`
- [AWS Fargate Security](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/security-fargate.html)
- [Firecracker Security](https://firecracker-microvm.github.io/)

---

## EOP-003

### Agent Tool Abuse

| Attribute | Value |
|-----------|-------|
| **Threat ID** | EOP-003 |
| **STRIDE Category** | Elevation of Privilege |
| **Severity** | 🟠 Medium |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | Medium |

#### Description

OpenClaw agents have access to powerful tools including shell execution, file operations, and browser automation. A compromised or jailbroken agent could abuse these capabilities to perform unauthorized actions.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Agent Dockerfile | `docker-files/Dockerfile.agent` |
| OpenClaw Config | Agent workspace `openclaw.json` |
| People Plugin | `packages/plugins/people/` |

#### Available Tools

| Tool | Capability | Risk |
|------|------------|------|
| Shell | Execute any command | High |
| Browser | Automate web interactions | Medium |
| File System | Read/write files | Medium |
| Matrix | Send messages | Low |
| People | Query org directory | Low |

#### Attack Vector

1. Attacker crafts prompt injection in Matrix message
2. Agent interprets malicious instructions
3. Agent executes shell commands or file operations
4. Attacker exfiltrates data or modifies system

#### Current Configuration

```typescript
// packages/setup/agent-runtime/src/index.ts:142-144
// Browser configured for headless operation
config.browser = config.browser || {};
config.browser.executablePath = '/usr/bin/chromium';
config.browser.headless = true;
```

#### Recommended Mitigations

1. **Tool allowlisting**: Restrict tools available to agents by role
2. **Command filtering**: Block dangerous shell commands
3. **Sandbox shell**: Run shell in restricted sandbox
4. **Output limits**: Limit file and shell output size
5. **Human approval**: Require approval for sensitive operations

#### Tool Restriction Example

```json
{
  "tools": {
    "shell": {
      "enabled": false
    },
    "browser": {
      "enabled": true,
      "allowedDomains": ["internal.anycompany.corp"]
    },
    "filesystem": {
      "enabled": true,
      "readOnly": true,
      "allowedPaths": ["/data/workspaces/$AGENT_ID/"]
    }
  }
}
```

#### References

- `docker-files/Dockerfile.agent`
- `packages/setup/agent-runtime/src/index.ts:142-144`
- [OpenClaw Documentation](https://openclaw.ai)
- `docs/findings/behaviors-to-avoid.md`

---

## EOP-004

### Docker Compose Root Access

| Attribute | Value |
|-----------|-------|
| **Threat ID** | EOP-004 |
| **STRIDE Category** | Elevation of Privilege |
| **Severity** | 🟡 Low |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | Medium |

#### Description

Docker Compose containers run as root by default, potentially allowing privilege escalation within the container and access to mounted volumes.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Docker Compose | `docker-files/docker-compose.yml` |
| Agent Dockerfile | `docker-files/Dockerfile.agent` |

#### Configuration

```dockerfile
# docker-files/Dockerfile.agent
FROM node:22
# No USER directive - runs as root
RUN mkdir -p /root/.openclaw/canvas /root/.openclaw/cron
```

```yaml
# docker-files/docker-compose.yml
# No user: directive - containers run as root
services:
  conduit:
    image: matrixconduit/matrix-conduit:latest
    # user: not specified
```

#### Mitigation Details

> ⚠️ **MITIGATED**: This docker-compose.yml is used exclusively for **local development** and is **NOT deployed to ECS/cloud environments**.

**Mitigation Notes:**
1. Docker Compose is only used for local development testing
2. Root access is limited to container namespace
3. Docker provides user namespace isolation
4. No sensitive host volumes mounted
5. Production deployment uses Fargate (no host access)

#### Production Alternative

In AWS ECS Fargate deployment:
- No host access regardless of container user
- IAM task roles scope permissions
- Firecracker provides kernel isolation
- User namespaces isolate container root

#### Best Practice for Development

For improved security in development environments:

```dockerfile
# Create non-root user
RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent
```

```yaml
# docker-compose.yml
services:
  agent:
    user: "1000:1000"  # Non-root user
```

#### References

- `docker-files/Dockerfile.agent`
- `docker-files/docker-compose.yml`
- [Docker Security Best Practices](https://docs.docker.com/develop/develop-images/security/)
