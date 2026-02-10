# Tampering Threats

> **Category:** Data integrity threats  
> **Last Updated:** 2026-02-07

Tampering threats involve unauthorized modification of data or code. In Open-Claw-Fleet, this concerns workspace configurations, container images, and inter-agent communications.

---

## TAMPER-001

### EFS Workspace Modification

| Attribute | Value |
|-----------|-------|
| **Threat ID** | TAMPER-001 |
| **STRIDE Category** | Tampering |
| **Severity** | 🔴 High |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | High |

#### Description

Multiple services (Conduit, Fleet Manager, Agents) share the same EFS filesystem with read-write access. A compromised agent could modify other agents' workspaces, inject malicious configurations, or corrupt the Conduit database.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| EFS Construct | `packages/aws/infra/lib/constructs/efs-construct.ts` |
| Agent Task Construct | `packages/aws/infra/lib/constructs/agent-task-construct.ts` |
| Fleet Manager Construct | `packages/aws/infra/lib/constructs/fleet-manager-service-construct.ts` |

#### Attack Vector

1. Attacker compromises an agent container (via OpenClaw vulnerability or prompt injection)
2. Attacker navigates to `/data/workspaces/` (EFS mount)
3. Attacker modifies other agents' configuration files (IDENTITY.md, openclaw.json)
4. Modified agents behave maliciously on next restart

#### Current Configuration

```typescript
// All services mount the same EFS root
// packages/aws/infra/lib/constructs/agent-task-construct.ts:91-98
this.taskDefinition.addVolume({
  name: volumeName,
  efsVolumeConfiguration: {
    fileSystemId: props.fileSystem.fileSystemId,
    transitEncryption: 'ENABLED',
    rootDirectory: '/',  // Full access to EFS root
  },
});
```

#### Recommended Mitigations

1. **EFS Access Points**: Create separate access points per agent with enforced paths
2. **Read-only mounts**: Mount workspace as read-only where possible
3. **File integrity monitoring**: Detect unauthorized changes to workspace files
4. **IAM-based EFS authorization**: Use IAM to restrict access to specific paths

#### References

- `packages/aws/infra/lib/constructs/efs-construct.ts`
- `packages/aws/infra/lib/constructs/agent-task-construct.ts:91-98`
- `docs/findings/agent-deployment.md` - EFS Mount Points section

---

## TAMPER-002

### Agent Configuration Injection

| Attribute | Value |
|-----------|-------|
| **Threat ID** | TAMPER-002 |
| **STRIDE Category** | Tampering |
| **Severity** | 🔴 High |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | High |

#### Description

Fleet Manager generates agent workspace configurations from templates and config.yaml. Malicious modification of templates or config files could inject harmful instructions into agent prompts or configurations.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Generator | `packages/setup/fleet-manager/src/generator.ts` |
| Config Loader | `packages/setup/fleet-manager/src/config.ts` |
| Templates | `config/templates/` |

#### Attack Vector

1. Attacker gains write access to S3 config bucket or EFS templates
2. Attacker modifies template files (SOUL.md, IDENTITY.md, skills/*)
3. Fleet Manager generates workspaces with malicious content
4. Agents execute with injected prompts or configurations

#### Vulnerable Code Flow

```typescript
// packages/setup/fleet-manager/src/generator.ts
// Templates are read from filesystem and merged into workspaces
// No integrity verification on template content
```

#### Recommended Mitigations

1. **Config signature verification**: Sign config.yaml and verify before use
2. **Template checksums**: Maintain checksums of approved templates
3. **S3 versioning and MFA delete**: Protect config bucket from tampering
4. **Restricted S3 bucket policy**: Limit write access to CI/CD only

#### References

- `packages/setup/fleet-manager/src/generator.ts`
- `packages/setup/fleet-manager/src/config.ts`
- `config/templates/`

---

## TAMPER-003

### Container Image Tampering

| Attribute | Value |
|-----------|-------|
| **Threat ID** | TAMPER-003 |
| **STRIDE Category** | Tampering |
| **Severity** | 🟠 Medium |
| **Status** | 🔴 Identified |
| **Likelihood** | Low |
| **Impact** | High |

#### Description

Container images stored in ECR could be tampered with if an attacker gains push access. Malicious images could contain backdoors, credential stealers, or modified agent behavior.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Shared Stack (ECR) | `packages/aws/infra/lib/stacks/shared-stack.ts` |
| Dockerfiles | `docker-files/` |
| Build Scripts | `scripts/build-images.sh` |

#### Attack Vector

1. Attacker compromises CI/CD pipeline or developer credentials
2. Attacker pushes malicious image to ECR repository
3. ECS pulls malicious image on next deployment
4. Malicious code executes in production environment

#### Current State

- ECR repositories created without image scanning
- No image signing or attestation
- Images tagged with `latest` may be overwritten

#### Recommended Mitigations

1. **ECR image scanning**: Enable automatic vulnerability scanning
2. **Image signing**: Implement Docker Content Trust or Sigstore
3. **Immutable tags**: Use Git SHA tags instead of `latest`
4. **ECR lifecycle policies**: Protect production tags from deletion
5. **IAM restrictions**: Limit push access to CI/CD service role only

#### References

- `packages/aws/infra/lib/stacks/shared-stack.ts`
- `scripts/build-images.sh`
- `docker-files/Dockerfile.agent`

---

## TAMPER-004

### Matrix Message Modification

| Attribute | Value |
|-----------|-------|
| **Threat ID** | TAMPER-004 |
| **STRIDE Category** | Tampering |
| **Severity** | 🟠 Medium |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | Medium |

#### Description

Matrix messages could potentially be modified in transit or at rest, leading to agents acting on falsified instructions.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Conduit Server | `docker-files/conduit.toml` |
| EFS Storage | Conduit database on EFS |

#### Mitigation Details

The Matrix protocol and Conduit implementation provide integrity protections:

1. **Event hashing**: All Matrix events have cryptographic hashes
2. **EFS encryption**: Transit encryption enabled for EFS
3. **Internal network**: Conduit only accessible within VPC
4. **No federation**: `allow_federation = false` prevents external modification

```toml
# docker-files/conduit.toml
allow_federation = false  # No external servers can send events
```

#### Current Configuration

```typescript
// packages/aws/infra/lib/constructs/agent-task-construct.ts
efsVolumeConfiguration: {
  transitEncryption: 'ENABLED',  // Encrypted in transit
}
```

#### References

- `docker-files/conduit.toml:8`
- `packages/aws/infra/lib/constructs/agent-task-construct.ts:95`

---

## TAMPER-005

### Docker Compose Volume Exposure

| Attribute | Value |
|-----------|-------|
| **Threat ID** | TAMPER-005 |
| **STRIDE Category** | Tampering |
| **Severity** | 🟡 Low |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | Medium |

#### Description

Docker Compose configuration mounts local directories into containers with read-write access, potentially allowing containers to modify host files.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Docker Compose | `docker-files/docker-compose.yml` |

#### Vulnerable Configuration

```yaml
# docker-files/docker-compose.yml
volumes:
  - conduit_data:/var/lib/matrix-conduit
  - ./conduit.toml:/etc/conduit.toml:ro  # Read-only mount
  - agent_vp_data:/root/.openclaw
  - ./templates/vp-engineering:/templates:ro  # Read-only mount
```

#### Mitigation Details

> ⚠️ **MITIGATED**: This docker-compose.yml is used exclusively for **local development** and is **NOT deployed to ECS/cloud environments**.

**Mitigation Notes:**
1. Docker Compose is only used for local development testing
2. Template mounts are read-only (`:ro` suffix)
3. Named volumes are container-isolated
4. Production deployment uses EFS with IAM controls
5. No host filesystem mounts in production

#### Production Alternative

In AWS ECS deployment:
- EFS volumes are used instead of host mounts
- IAM policies control access permissions
- No direct host filesystem access from containers

#### References

- `docker-files/docker-compose.yml:10-14, 44-45, 64-65`
- `docs/ARCHITECTURE.md` - Storage section
