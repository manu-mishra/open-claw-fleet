# EFS Access Point Security Analysis

**Date:** February 17, 2026  
**Issue:** Agents can currently access all files on EFS - need per-agent isolation

---

## Current Security Posture

### ❌ PROBLEM: Shared Root Access

**Current Configuration:**
```typescript
// agent-task-construct.ts (line 90-98)
this.taskDefinition.addVolume({
  name: volumeName,
  efsVolumeConfiguration: {
    fileSystemId: props.fileSystem.fileSystemId,
    transitEncryption: 'ENABLED',
    rootDirectory: '/',  // ❌ ALL agents mount EFS root
  },
});

// Container mount (line 130)
.addMountPoints({
  sourceVolume: volumeName,
  containerPath: '/data',  // ❌ Full EFS visible at /data
  readOnly: false,
});
```

**What This Means:**
```
Agent Container View:
/data/
├── workspaces/
│   ├── Engineering/
│   │   ├── aaron.phillips/     ← Agent can read this
│   │   ├── dylan.thomas/       ← Agent can read this
│   │   └── sarah.chen/         ← Agent can read this
│   └── Executive/
│       └── braxton.roberts/    ← Agent can read this
└── config/
    └── ...                     ← Agent can read this
```

**Security Risk:** ⚠️ **HIGH**
- Any agent can read/write ANY other agent's workspace
- Agent can read `MEMORY.md` of other agents
- Agent can modify other agents' files
- No isolation between agents

---

## Recommended Solution: EFS Access Points

### ✅ Per-Agent Access Points

**What are EFS Access Points?**
- Virtual entry points into EFS filesystem
- Enforce specific directory as root
- Apply POSIX user/group permissions
- Isolate agents from each other

**Architecture:**
```
EFS Filesystem (fs-xxxxx)
├── workspaces/
│   ├── Engineering/
│   │   ├── aaron.phillips/     ← Access Point 1 (only sees this)
│   │   ├── dylan.thomas/       ← Access Point 2 (only sees this)
│   │   └── sarah.chen/         ← Access Point 3 (only sees this)
│   └── Executive/
│       └── braxton.roberts/    ← Access Point 4 (only sees this)
```

**Agent Container View (with Access Point):**
```
Agent aaron.phillips sees:
/workspace/
├── IDENTITY.md
├── SOUL.md
├── MEMORY.md
├── memory/
├── sessions/
└── skills/

❌ CANNOT see other agents' directories
❌ CANNOT navigate to parent directories
✅ Isolated to own workspace
```

---

## Implementation Plan

### Step 1: Create Access Points Dynamically

**Update:** `packages/aws/infra/lib/constructs/agent-task-construct.ts`

Add method to create access points:

```typescript
import * as efs from 'aws-cdk-lib/aws-efs';

export interface AgentTaskConstructProps {
  // ... existing props
  createAccessPoint?: boolean;  // Enable per-agent access points
}

export class AgentTaskConstruct extends Construct {
  // ... existing code

  private createAgentAccessPoint(
    fileSystem: efs.IFileSystem,
    agentId: string,
    department: string
  ): efs.AccessPoint {
    // Sanitize agent ID for path (remove @ and domain)
    const sanitizedId = agentId.replace(/[@:]/g, '').replace('.anycompany.corp', '');
    
    return new efs.AccessPoint(this, `AccessPoint-${sanitizedId}`, {
      fileSystem,
      path: `/workspaces/${department}/${sanitizedId}`,
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '755',
      },
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
    });
  }
}
```

### Step 2: Update Task Definition to Use Access Points

**Problem:** Access points must be created at CDK deploy time, but agent IDs are dynamic.

**Solution Options:**

#### Option A: Pre-create Access Points for Known Agents
```typescript
// In environment-stack.ts
const agents = [
  { id: 'aaron.phillips', dept: 'Engineering' },
  { id: 'dylan.thomas', dept: 'Engineering' },
  { id: 'braxton.roberts', dept: 'Executive' },
];

const accessPoints = agents.map(agent => 
  new efs.AccessPoint(this, `AP-${agent.id}`, {
    fileSystem: props.fileSystem,
    path: `/workspaces/${agent.dept}/${agent.id}`,
    createAcl: { ownerUid: '1000', ownerGid: '1000', permissions: '755' },
    posixUser: { uid: '1000', gid: '1000' },
  })
);
```

**Pros:** Simple, secure  
**Cons:** Requires CDK deploy for new agents

#### Option B: Dynamic Access Point Creation (Recommended)
Use AWS SDK to create access points at runtime when deploying agents.

**Update:** `packages/setup/fleet-manager/src/ecs-orchestrator.ts`

```typescript
import { EFSClient, CreateAccessPointCommand, DescribeAccessPointsCommand } from '@aws-sdk/client-efs';

export class EcsOrchestrator implements Orchestrator {
  private efs: EFSClient;

  constructor(config: EcsOrchestratorConfig) {
    // ... existing code
    this.efs = new EFSClient({ region: config.region });
  }

  private async ensureAccessPoint(
    matrixId: string,
    workspacePath: string
  ): Promise<string> {
    // Check if access point exists
    const sanitizedId = matrixId.replace(/[@:]/g, '').replace('.anycompany.corp', '');
    const tagKey = 'AgentId';
    const tagValue = sanitizedId;

    try {
      const existing = await this.efs.send(new DescribeAccessPointsCommand({
        FileSystemId: this.config.fileSystemId,
      }));

      const found = existing.AccessPoints?.find(ap => 
        ap.Tags?.some(t => t.Key === tagKey && t.Value === tagValue)
      );

      if (found) {
        return found.AccessPointId!;
      }
    } catch (err) {
      console.warn('Failed to check existing access points:', err);
    }

    // Create new access point
    const result = await this.efs.send(new CreateAccessPointCommand({
      FileSystemId: this.config.fileSystemId,
      PosixUser: {
        Uid: 1000,
        Gid: 1000,
      },
      RootDirectory: {
        Path: workspacePath.replace('/data', ''),  // Remove /data prefix
        CreationInfo: {
          OwnerUid: 1000,
          OwnerGid: 1000,
          Permissions: '755',
        },
      },
      Tags: [
        { Key: tagKey, Value: tagValue },
        { Key: 'ManagedBy', Value: 'fleet-manager' },
      ],
    }));

    console.log(`✅ Created access point: ${result.AccessPointId}`);
    return result.AccessPointId!;
  }

  async startAgent(params: StartAgentParams): Promise<AgentHandle> {
    // ... existing code

    // Create/get access point for this agent
    const accessPointId = await this.ensureAccessPoint(
      params.matrixId,
      params.workspacePath
    );

    // Run ECS task with access point
    const result = await this.ecs.send(new RunTaskCommand({
      cluster: this.config.clusterArn,
      taskDefinition: this.config.taskDefinitionArn,
      launchType: 'FARGATE',
      networkConfiguration: { /* ... */ },
      overrides: {
        containerOverrides: [{
          name: 'agent',
          environment: [
            { name: 'AGENT_MATRIX_ID', value: matrixId },
            { name: 'MATRIX_HOMESERVER', value: homeserver },
            { name: 'WORKSPACE_PATH', value: '/workspace' },  // Now isolated!
            { name: 'ACCESS_POINT_ID', value: accessPointId },
          ],
        }],
      },
    }));

    // ... rest of code
  }
}
```

### Step 3: Update Task Definition to Use Access Point

**Update:** `packages/aws/infra/lib/constructs/agent-task-construct.ts`

```typescript
// Change volume configuration to support access points
this.taskDefinition.addVolume({
  name: volumeName,
  efsVolumeConfiguration: {
    fileSystemId: props.fileSystem.fileSystemId,
    transitEncryption: 'ENABLED',
    // Access point will be specified at runtime via task overrides
    authorizationConfig: {
      iam: 'ENABLED',  // Require IAM for access point
    },
  },
});
```

**Update ECS Task Override at Runtime:**
```typescript
// In ecs-orchestrator.ts startAgent()
overrides: {
  containerOverrides: [{
    name: 'agent',
    environment: [ /* ... */ ],
    // Override volume to use access point
    mountPoints: [{
      sourceVolume: 'agent-data',
      containerPath: '/workspace',
      readOnly: false,
    }],
  }],
  // Specify access point in volume override
  volumes: [{
    name: 'agent-data',
    efsVolumeConfiguration: {
      fileSystemId: this.config.fileSystemId,
      transitEncryption: 'ENABLED',
      authorizationConfig: {
        accessPointId: accessPointId,
        iam: 'ENABLED',
      },
    },
  }],
}
```

### Step 4: Update IAM Permissions

**Update:** `packages/aws/infra/lib/constructs/agent-task-construct.ts`

```typescript
// Grant EFS access point permissions
executionRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'elasticfilesystem:ClientMount',
    'elasticfilesystem:ClientWrite',
  ],
  resources: [props.fileSystem.fileSystemArn],
  conditions: {
    StringEquals: {
      'elasticfilesystem:AccessPointArn': `${props.fileSystem.fileSystemArn}/access-point/*`,
    },
  },
}));

// Fleet Manager needs permission to create access points
// Add to fleet-manager-service-construct.ts
taskRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'elasticfilesystem:CreateAccessPoint',
    'elasticfilesystem:DescribeAccessPoints',
    'elasticfilesystem:TagResource',
  ],
  resources: [props.fileSystem.fileSystemArn],
}));
```

---

## Security Comparison

### Before (Current):
```
Agent aaron.phillips:
  Mount: /data → EFS:/
  Can access:
    ✅ /data/workspaces/Engineering/aaron.phillips/
    ❌ /data/workspaces/Engineering/dylan.thomas/      (SHOULD NOT ACCESS)
    ❌ /data/workspaces/Executive/braxton.roberts/     (SHOULD NOT ACCESS)
    ❌ /data/config/                                    (SHOULD NOT ACCESS)
```

### After (With Access Points):
```
Agent aaron.phillips:
  Mount: /workspace → EFS:/workspaces/Engineering/aaron.phillips (via Access Point)
  Can access:
    ✅ /workspace/MEMORY.md
    ✅ /workspace/memory/
    ✅ /workspace/sessions/
    ❌ Cannot see other agents (isolated at filesystem level)
    ❌ Cannot navigate to parent directories
```

---

## Migration Path

### Phase 1: Add Access Point Support (Non-Breaking)
1. Update CDK to support access points (optional flag)
2. Update Fleet Manager to create access points
3. Test with one agent using access point
4. Verify isolation works

### Phase 2: Enable for All Agents
1. Deploy updated Fleet Manager
2. Restart agents (will auto-create access points)
3. Verify all agents isolated

### Phase 3: Remove Root Access (Breaking)
1. Update task definition to require access points
2. Remove `ClientRootAccess` permission
3. Deploy

---

## Testing Plan

### Test 1: Verify Isolation
```bash
# SSH into agent container
aws ecs execute-command --cluster <cluster> --task <task-arn> --container agent --interactive --command /bin/sh

# Try to access other agent's workspace
ls /workspace/../dylan.thomas/  # Should fail with "Permission denied"
cd /workspace/..                # Should fail or show empty
```

### Test 2: Verify Own Workspace Works
```bash
# In agent container
ls /workspace/                  # Should show MEMORY.md, memory/, etc.
echo "test" > /workspace/test.txt  # Should succeed
cat /workspace/MEMORY.md        # Should succeed
```

### Test 3: Verify Memory Persistence
```bash
# Write to memory
echo "Important note" >> /workspace/MEMORY.md

# Restart container
aws ecs stop-task --cluster <cluster> --task <task-arn>

# Start new task (Fleet Manager will auto-restart)
# Verify file still exists
cat /workspace/MEMORY.md  # Should contain "Important note"
```

---

## Cost Impact

**EFS Access Points:**
- **Cost:** $0 (no additional charge)
- **Limit:** 1000 access points per filesystem (more than enough)

**Performance:**
- **Impact:** None (access points are virtual, no overhead)

---

## Rollback Plan

If issues occur:

1. **Immediate:** Set `createAccessPoint: false` in config
2. **Redeploy:** Fleet Manager will use root mount
3. **Investigate:** Check CloudWatch logs for errors
4. **Fix:** Address issues and re-enable

---

## Recommendations

### ✅ Implement Access Points (High Priority)

**Why:**
- **Security:** Prevents agents from accessing each other's data
- **Compliance:** Required for multi-tenant isolation
- **Best Practice:** AWS recommended approach
- **Zero Cost:** No additional charges

**Timeline:**
- Week 1: Implement dynamic access point creation
- Week 2: Test with subset of agents
- Week 3: Roll out to all agents
- Week 4: Remove root access (enforce isolation)

### ✅ Additional Security Measures

1. **Enable EFS Encryption in Transit:** ✅ Already enabled
2. **Enable EFS Encryption at Rest:** ✅ Should be enabled
3. **Use IAM for Access Point Authorization:** ✅ Recommended
4. **Audit EFS Access Logs:** ⏳ Enable CloudWatch logging
5. **Implement File Integrity Monitoring:** ⏳ Optional

---

## Summary

### Current State: ❌ INSECURE
- All agents share EFS root mount
- Any agent can access any other agent's files
- No isolation between agents

### Recommended State: ✅ SECURE
- Each agent gets dedicated access point
- Agent can only access own workspace
- Filesystem-level isolation enforced
- Zero additional cost

### Action Items:
1. ✅ Review this analysis
2. ⏳ Implement dynamic access point creation
3. ⏳ Update task definition to use access points
4. ⏳ Test with one agent
5. ⏳ Roll out to all agents
6. ⏳ Remove root access permissions

---

**Conclusion:** Your concern is valid. Current setup allows agents to access each other's files. Implementing EFS Access Points will provide proper isolation at zero additional cost.
