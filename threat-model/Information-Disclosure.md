# Information Disclosure Threats

> **Category:** Confidentiality threats  
> **Last Updated:** 2026-02-07

Information disclosure threats involve exposing sensitive information to unauthorized parties. In Open-Claw-Fleet, this concerns secrets, agent data, credentials, and organizational information.

---

## INFO-001

### Fleet Secret Exposure in Logs

| Attribute | Value |
|-----------|-------|
| **Threat ID** | INFO-001 |
| **STRIDE Category** | Information Disclosure |
| **Severity** | 🔴 High |
| **Status** | 🟡 Partially Mitigated |
| **Likelihood** | Medium |
| **Impact** | High |

#### Description

The fleet secret and derived passwords are partially logged during agent startup and Fleet Manager operations. While truncated, this provides hints about secret values that could aid in targeted attacks.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Agent Runtime | `packages/setup/agent-runtime/src/index.ts` |
| Fleet Manager | `packages/setup/fleet-manager/src/index.ts` |
| CloudWatch Logs | `/ecs/agent-{env}`, `/ecs/fleet-manager-{env}` |

#### Vulnerable Code

```typescript
// packages/setup/agent-runtime/src/index.ts:19
console.log(`Using FLEET_SECRET from environment (length: ${FLEET_SECRET.length}, starts with: ${FLEET_SECRET.slice(0, 4)}...)`);

// packages/setup/agent-runtime/src/index.ts:73
console.log(`Derived password: ${password.slice(0, 8)}...`);

// packages/setup/fleet-manager/src/index.ts:506-507
console.log(`Derived password for ${matrixId}: ${password.slice(0, 8)}... (secret starts with: ${this.fleetSecret.slice(0, 4)}...)`);
```

#### Log Output Example

```
Using FLEET_SECRET from environment (length: 32, starts with: 6rjt...)
Derived password: 5f26ba53...
```

#### Partial Mitigation

- Only first 4-8 characters logged (truncated)
- Logs retained for only 7 days
- CloudWatch Logs access controlled by IAM

#### Recommended Additional Mitigations

1. **Remove secret logging**: Remove all secret value logging
2. **Log sanitization**: Implement log filtering to redact secrets
3. **Structured logging**: Use markers for sensitive fields
4. **Audit log access**: Monitor who accesses CloudWatch Logs

#### Secure Logging Alternative

```typescript
// Instead of logging secret values
console.log(`Using FLEET_SECRET from environment (valid: ${!!FLEET_SECRET})`);
console.log(`Derived password successfully for ${matrixId}`);
```

#### References

- `packages/setup/agent-runtime/src/index.ts:19, 73`
- `packages/setup/fleet-manager/src/index.ts:506-507`
- `docs/findings/agent-deployment.md` - Verification section

---

## INFO-002

### Agent Memory Data Leakage

| Attribute | Value |
|-----------|-------|
| **Threat ID** | INFO-002 |
| **STRIDE Category** | Information Disclosure |
| **Severity** | 🔴 High |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | High |

#### Description

Agent workspaces on EFS contain persistent memory, conversation history, and potentially sensitive organizational data. Shared EFS access means any agent can read other agents' workspaces.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| EFS Mount Configuration | `packages/aws/infra/lib/constructs/agent-task-construct.ts` |
| Workspace Generator | `packages/setup/fleet-manager/src/generator.ts` |
| EFS Storage | `/data/workspaces/` |

#### Attack Vector

1. Agent compromised via prompt injection or vulnerability
2. Agent reads `/data/workspaces/` directory listing
3. Agent accesses other agents' memory files
4. Sensitive organizational data exfiltrated

#### Current State

All agents mount the same EFS root:
```typescript
// packages/aws/infra/lib/constructs/agent-task-construct.ts:127-131
.addMountPoints({
  sourceVolume: volumeName,
  containerPath: '/data',
  readOnly: false,  // Read-write access
});
```

Directory structure:
```
/data/workspaces/
├── Engineering/
│   ├── aaron.phillips/
│   │   ├── openclaw.json
│   │   ├── IDENTITY.md
│   │   └── memory/
│   └── braxton.roberts/
├── Sales/
│   └── ...
└── org.json  # Full organizational data
```

#### Recommended Mitigations

1. **EFS Access Points**: Create per-agent access points with path enforcement
2. **Read-only workspace**: Mount workspace as read-only
3. **Data classification**: Implement sensitivity labels for agent data
4. **Runtime isolation**: Use separate EFS filesystems per department
5. **Memory encryption**: Encrypt sensitive memory files at rest

#### References

- `packages/aws/infra/lib/constructs/agent-task-construct.ts:127-131`
- `packages/setup/fleet-manager/src/generator.ts`
- `docs/findings/agent-deployment.md` - EFS Mount Points section

---

## INFO-003

### Bedrock API Key Exposure

| Attribute | Value |
|-----------|-------|
| **Threat ID** | INFO-003 |
| **STRIDE Category** | Information Disclosure |
| **Severity** | 🟠 Medium |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | Medium |

#### Description

AI model API credentials (AWS Bedrock) could be exposed if hardcoded or improperly managed, allowing unauthorized use of AI services.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Agent Task Construct | `packages/aws/infra/lib/constructs/agent-task-construct.ts` |
| Agent Runtime | `packages/setup/agent-runtime/src/index.ts` |

#### Mitigation Details

Bedrock access is managed via IAM roles, not API keys:

1. **IAM Role-Based Access**: Agents use task role for Bedrock
2. **No API Keys**: No hardcoded credentials in code
3. **Scoped Permissions**: Only InvokeModel permissions granted
4. **VPC Endpoint**: Bedrock accessed via private endpoint

```typescript
// packages/aws/infra/lib/constructs/agent-task-construct.ts:47-50
this.taskRole.addToPolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
  resources: ['*'],  // All foundation models
}));
```

#### VPC Endpoint Configuration

```typescript
// packages/aws/infra/lib/constructs/network-construct.ts:55-57
this.vpc.addInterfaceEndpoint('BedrockEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
});
```

#### Benefits

- ✅ No API keys to leak
- ✅ Credentials rotate automatically
- ✅ Access logged via CloudTrail
- ✅ Private network path to Bedrock

#### References

- `packages/aws/infra/lib/constructs/agent-task-construct.ts:47-50`
- `packages/aws/infra/lib/constructs/network-construct.ts:55-57`
- `docs/ARCHITECTURE.md` - IAM Roles & Policies section

---

## INFO-004

### Matrix Room Membership Disclosure

| Attribute | Value |
|-----------|-------|
| **Threat ID** | INFO-004 |
| **STRIDE Category** | Information Disclosure |
| **Severity** | 🟠 Medium |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | Medium |

#### Description

Matrix room membership is visible to all room members, revealing organizational structure. Rooms are created with `public_chat` preset, making them discoverable.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Fleet Manager | `packages/setup/fleet-manager/src/index.ts` |
| Room Creation | Fleet Manager Matrix setup |

#### Vulnerable Code

```typescript
// packages/setup/fleet-manager/src/index.ts:426-429
await this.matrixRequest(homeserver, 'POST', '/_matrix/client/r0/createRoom', {
  name, room_alias_name: alias, preset: 'public_chat'  // Publicly discoverable
}, token);
```

#### Exposure Details

- Room membership reveals organizational hierarchy
- Public rooms can be discovered via room directory
- All members can see who else is in the room
- Room aliases reveal department structure

#### Current Room Types

| Room Alias | Members | Visibility |
|------------|---------|------------|
| `#all-employees` | All agents | Public |
| `#engineering-leadership` | VPs, Directors | Public |
| `#platform-team` | Team members | Public |

#### Recommended Mitigations

1. **Private rooms**: Use `private_chat` preset for sensitive rooms
2. **Invite-only**: Require explicit invitations
3. **Room directory**: Disable public room directory
4. **Membership audit**: Periodically review room membership

#### References

- `packages/setup/fleet-manager/src/index.ts:426-429`
- `docs/ARCHITECTURE.md` - Room Structure section

---

## INFO-005

### Docker Compose AWS Credentials

| Attribute | Value |
|-----------|-------|
| **Threat ID** | INFO-005 |
| **STRIDE Category** | Information Disclosure |
| **Severity** | 🟡 Low |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | Medium |

#### Description

Docker Compose configuration passes AWS credentials via environment variables, which could be exposed in process listings or container inspection.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Docker Compose | `docker-files/docker-compose.yml` |

#### Configuration

```yaml
# docker-files/docker-compose.yml:35-38
environment:
  AWS_REGION: ${AWS_REGION:-us-east-1}
  AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
  AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
  AWS_SESSION_TOKEN: ${AWS_SESSION_TOKEN}
```

#### Mitigation Details

> ⚠️ **MITIGATED**: This docker-compose.yml is used exclusively for **local development** and is **NOT deployed to ECS/cloud environments**.

**Mitigation Notes:**
1. Docker Compose is only used for local development testing
2. Credentials sourced from host environment variables (not hardcoded)
3. Session tokens are temporary and expire
4. Production deployment uses IAM task roles (no credentials needed)
5. Local network access required to exploit

#### Production Alternative

In AWS ECS deployment:
- IAM task roles provide credentials automatically
- No environment variable credential passing
- Credentials managed by EC2/ECS metadata service
- VPC endpoints used for AWS service access

#### References

- `docker-files/docker-compose.yml:35-38`
- `packages/aws/infra/lib/constructs/agent-task-construct.ts` - IAM role configuration
- `docs/ARCHITECTURE.md` - IAM Roles & Policies section
