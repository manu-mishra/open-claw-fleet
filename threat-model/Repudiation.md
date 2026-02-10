# Repudiation Threats

> **Category:** Audit and logging threats  
> **Last Updated:** 2026-02-07

Repudiation threats involve a user or system denying having performed an action. In Open-Claw-Fleet, this concerns audit trails for agent actions, message history, and administrative operations.

---

## REPUD-001

### Insufficient Agent Action Logging

| Attribute | Value |
|-----------|-------|
| **Threat ID** | REPUD-001 |
| **STRIDE Category** | Repudiation |
| **Severity** | 🟠 Medium |
| **Status** | 🔴 Identified |
| **Likelihood** | High |
| **Impact** | Medium |

#### Description

Agent actions (tool executions, shell commands, browser automation) are not comprehensively logged with sufficient detail for forensic analysis. If an agent performs a harmful action, it may be difficult to reconstruct the sequence of events.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Agent Runtime | `packages/setup/agent-runtime/src/index.ts` |
| OpenClaw Framework | External dependency |
| CloudWatch Logs | `/ecs/agent-{env}` |

#### Current State

Agent logging includes:
- ✅ Startup and authentication events
- ✅ Room join operations
- ✅ High-level OpenClaw gateway status
- ❌ Individual tool execution details
- ❌ Shell command outputs
- ❌ File operation audit trail
- ❌ Browser automation actions

#### Log Output Example

```
Using FLEET_SECRET from environment (length: 32, starts with: 6rjt...)
Attempting login for aaron.phillips (matrix ID: @aaron.phillips:anycompany.corp)
Logged in as @aaron.phillips:anycompany.corp
Joining rooms as VP in Engineering
Joined #all-employees
Starting OpenClaw...
[gateway] listening on ws://127.0.0.1:20206
```

#### Recommended Mitigations

1. **Structured logging**: Implement JSON-structured logs with action types
2. **Tool execution logging**: Log all tool invocations with parameters and results
3. **Correlation IDs**: Track request chains across systems
4. **Log aggregation**: Send logs to central SIEM for analysis
5. **Retention policy**: Define appropriate log retention periods

#### References

- `packages/setup/agent-runtime/src/index.ts`
- `docs/findings/agent-deployment.md` - Verification section

---

## REPUD-002

### CloudWatch Log Gaps

| Attribute | Value |
|-----------|-------|
| **Threat ID** | REPUD-002 |
| **STRIDE Category** | Repudiation |
| **Severity** | 🟠 Medium |
| **Status** | 🟡 Partially Mitigated |
| **Likelihood** | Medium |
| **Impact** | Medium |

#### Description

CloudWatch logging is configured for all ECS services, but log retention is set to one week, which may be insufficient for incident investigation. Additionally, log groups could be deleted or modified.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Agent Task Construct | `packages/aws/infra/lib/constructs/agent-task-construct.ts` |
| Fleet Manager Construct | `packages/aws/infra/lib/constructs/fleet-manager-service-construct.ts` |
| Conduit Service Construct | `packages/aws/infra/lib/constructs/conduit-service-construct.ts` |

#### Current Configuration

```typescript
// packages/aws/infra/lib/constructs/agent-task-construct.ts:113-119
logGroup: new logs.LogGroup(this, 'LogGroup', {
  logGroupName: `/ecs/agent-${props.environment}`,
  retention: logs.RetentionDays.ONE_WEEK,  // Only 7 days
  removalPolicy: cdk.RemovalPolicy.DESTROY,  // Deleted with stack
}),
```

#### Partial Mitigation

- CloudWatch Logs are centralized and accessible
- AWS CloudTrail logs API activity (separate)
- ECS task events logged to CloudWatch Events

#### Gaps

- Short retention period (7 days)
- `DESTROY` removal policy deletes logs with stack
- No log export to S3 for long-term retention
- No tamper-protection on log groups

#### Recommended Additional Mitigations

1. **Increase retention**: Set retention to 90+ days for production
2. **Change removal policy**: Use `RETAIN` for production log groups
3. **S3 export**: Configure log export to S3 with lifecycle policies
4. **Log group policy**: Add resource policy to prevent deletion
5. **CloudWatch Alarms**: Alert on log delivery failures

#### References

- `packages/aws/infra/lib/constructs/agent-task-construct.ts:113-119`
- `packages/aws/infra/lib/constructs/fleet-manager-service-construct.ts:135-140`

---

## REPUD-003

### Matrix Message Audit Trail

| Attribute | Value |
|-----------|-------|
| **Threat ID** | REPUD-003 |
| **STRIDE Category** | Repudiation |
| **Severity** | 🟡 Low |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | Low |

#### Description

Matrix messages between agents could potentially be denied or disputed without proper audit trail. An agent could claim it did not send a particular message.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Conduit Server | `docker-files/conduit.toml` |
| EFS Storage | `/var/lib/matrix-conduit/` |

#### Mitigation Details

The Matrix protocol provides inherent non-repudiation:

1. **Event IDs**: All messages have unique, immutable event IDs
2. **Server timestamps**: Conduit records server-side timestamps
3. **Sender verification**: Events include cryptographically verified sender
4. **Persistent storage**: Database persisted to EFS
5. **No message deletion**: Default configuration doesn't allow message deletion

#### Matrix Event Structure

```json
{
  "event_id": "$unique_event_id",
  "sender": "@agent.name:anycompany.corp",
  "origin_server_ts": 1707307200000,
  "type": "m.room.message",
  "content": {
    "body": "Message content",
    "msgtype": "m.text"
  }
}
```

#### Storage Configuration

```typescript
// EFS mount for persistent storage
efsVolumeConfiguration: {
  fileSystemId: props.fileSystem.fileSystemId,
  transitEncryption: 'ENABLED',
}
```

Conduit database path:
```toml
# docker-files/conduit.toml
database_path = "/var/lib/matrix-conduit/"
database_backend = "rocksdb"
```

#### Additional Considerations

- Consider enabling Matrix event encryption for sensitive rooms
- Implement periodic database backups for disaster recovery
- Document message retention policy

#### References

- `docker-files/conduit.toml:3-4`
- `docs/ARCHITECTURE.md` - Communication Layer section
- Matrix Specification: Event Format
