# STRIDE Threat Overview

> **Last Updated:** 2026-02-07

This document provides a consolidated view of all identified security threats organized by STRIDE category.

## Threat Index

### Spoofing (S) - Identity Threats

| ID | Threat | Severity | Status | Component |
|----|--------|----------|--------|-----------|
| [SPOOF-001](./Spoofing.md#spoof-001) | Unauthorized Matrix User Registration | High | 🔴 Identified | Conduit |
| [SPOOF-002](./Spoofing.md#spoof-002) | Agent Identity Impersonation | High | 🔴 Identified | Agent Runtime |
| [SPOOF-003](./Spoofing.md#spoof-003) | Stolen Access Token Reuse | Medium | 🟡 Partial | Matrix Protocol |
| [SPOOF-004](./Spoofing.md#spoof-004) | Fleet Secret Compromise | Medium | 🟢 Mitigated | Secrets Manager |
| [SPOOF-005](./Spoofing.md#spoof-005) | Docker Compose Weak Passwords | Low | 🟢 Mitigated | docker-compose.yml |

### Tampering (T) - Integrity Threats

| ID | Threat | Severity | Status | Component |
|----|--------|----------|--------|-----------|
| [TAMPER-001](./Tampering.md#tamper-001) | EFS Workspace Modification | High | 🔴 Identified | EFS Storage |
| [TAMPER-002](./Tampering.md#tamper-002) | Agent Configuration Injection | High | 🔴 Identified | Fleet Manager |
| [TAMPER-003](./Tampering.md#tamper-003) | Container Image Tampering | Medium | 🔴 Identified | ECR |
| [TAMPER-004](./Tampering.md#tamper-004) | Matrix Message Modification | Medium | 🟢 Mitigated | Conduit |
| [TAMPER-005](./Tampering.md#tamper-005) | Docker Compose Volume Exposure | Low | 🟢 Mitigated | docker-compose.yml |

### Repudiation (R) - Audit Threats

| ID | Threat | Severity | Status | Component |
|----|--------|----------|--------|-----------|
| [REPUD-001](./Repudiation.md#repud-001) | Insufficient Agent Action Logging | Medium | 🔴 Identified | Agent Runtime |
| [REPUD-002](./Repudiation.md#repud-002) | CloudWatch Log Gaps | Medium | 🟡 Partial | CloudWatch |
| [REPUD-003](./Repudiation.md#repud-003) | Matrix Message Audit Trail | Low | 🟢 Mitigated | Conduit/EFS |

### Information Disclosure (I) - Confidentiality Threats

| ID | Threat | Severity | Status | Component |
|----|--------|----------|--------|-----------|
| [INFO-001](./Information-Disclosure.md#info-001) | Fleet Secret Exposure in Logs | High | 🟡 Partial | Fleet Manager |
| [INFO-002](./Information-Disclosure.md#info-002) | Agent Memory Data Leakage | High | 🔴 Identified | EFS Storage |
| [INFO-003](./Information-Disclosure.md#info-003) | Bedrock API Key Exposure | Medium | 🟢 Mitigated | IAM Roles |
| [INFO-004](./Information-Disclosure.md#info-004) | Matrix Room Membership Disclosure | Medium | 🔴 Identified | Conduit |
| [INFO-005](./Information-Disclosure.md#info-005) | Docker Compose AWS Credentials | Low | 🟢 Mitigated | docker-compose.yml |

### Denial of Service (D) - Availability Threats

| ID | Threat | Severity | Status | Component |
|----|--------|----------|--------|-----------|
| [DOS-001](./Denial-of-Service.md#dos-001) | Agent Task Exhaustion | High | 🔴 Identified | ECS Cluster |
| [DOS-002](./Denial-of-Service.md#dos-002) | EFS Storage Exhaustion | Medium | 🔴 Identified | EFS |
| [DOS-003](./Denial-of-Service.md#dos-003) | Matrix Message Flood | Medium | 🔴 Identified | Conduit |
| [DOS-004](./Denial-of-Service.md#dos-004) | Docker Compose Resource Limits | Low | 🟢 Mitigated | docker-compose.yml |

### Elevation of Privilege (E) - Authorization Threats

| ID | Threat | Severity | Status | Component |
|----|--------|----------|--------|-----------|
| [EOP-001](./Elevation-of-Privilege.md#eop-001) | Overly Permissive IAM Policies | High | 🔴 Identified | IAM |
| [EOP-002](./Elevation-of-Privilege.md#eop-002) | Container Escape | Medium | 🟢 Mitigated | ECS Fargate |
| [EOP-003](./Elevation-of-Privilege.md#eop-003) | Agent Tool Abuse | Medium | 🔴 Identified | OpenClaw |
| [EOP-004](./Elevation-of-Privilege.md#eop-004) | Docker Compose Root Access | Low | 🟢 Mitigated | docker-compose.yml |

## Risk Heat Map

```
                    IMPACT
              Low    Medium    High
         ┌─────────┬─────────┬─────────┐
    High │         │ DOS-003 │ SPOOF-001│
         │         │ REPUD-002│ SPOOF-002│
         │         │         │ TAMPER-001│
         │         │         │ TAMPER-002│
LIKELIHOOD├─────────┼─────────┼─────────┤
  Medium │ SPOOF-005│ TAMPER-003│ INFO-001│
         │ TAMPER-005│ INFO-004│ INFO-002│
         │         │ DOS-002 │ DOS-001 │
         │         │ EOP-003 │ EOP-001 │
         ├─────────┼─────────┼─────────┤
    Low  │ REPUD-003│ SPOOF-003│ TAMPER-003│
         │ INFO-005│ SPOOF-004│         │
         │ DOS-004 │ INFO-003│         │
         │ EOP-004 │ REPUD-001│         │
         │ EOP-002 │         │         │
         └─────────┴─────────┴─────────┘
```

## Mitigated Threats Summary

The following threats have been identified and marked as **MITIGATED**:

### Docker Compose Related (Local Development Only)

> ⚠️ **Note**: Docker Compose configuration (`docker-compose.yml`) is used exclusively for **local development** and is **NOT deployed to ECS/cloud environments**. The following threats are mitigated by deployment architecture.

- **SPOOF-005**: Weak passwords in docker-compose.yml
- **TAMPER-005**: Volume mount exposure in docker-compose.yml
- **INFO-005**: AWS credentials in docker-compose.yml environment
- **DOS-004**: Resource limits in docker-compose.yml
- **EOP-004**: Root container access in docker-compose.yml

### Infrastructure Mitigations

- **SPOOF-004**: Fleet secret stored in AWS Secrets Manager with IAM controls
- **TAMPER-004**: Matrix messages integrity via Conduit database
- **INFO-003**: Bedrock access via IAM role, no API keys in code
- **EOP-002**: Fargate provides kernel-level isolation, no container escape vector
- **REPUD-003**: Matrix messages persisted to EFS for audit trail

## Open Threats Requiring Action

### Priority 1 (Critical)
1. SPOOF-001: Implement registration controls
2. SPOOF-002: Implement agent identity verification
3. TAMPER-001: Implement EFS access controls
4. TAMPER-002: Implement config validation
5. INFO-002: Implement data isolation

### Priority 2 (Important)
1. DOS-001: Implement resource quotas
2. EOP-001: Implement least-privilege IAM
3. INFO-001: Implement log sanitization
4. REPUD-001: Implement comprehensive logging

### Priority 3 (Monitor)
1. TAMPER-003: Implement image signing
2. DOS-002: Monitor storage usage
3. DOS-003: Implement rate limiting
4. INFO-004: Review room access controls
