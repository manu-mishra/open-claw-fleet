# Threat Tracking

> **Last Updated:** 2026-02-07

This document provides a consolidated tracking view of all identified and mitigated threats.

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Threats | 26 |
| Identified (Open) | 14 |
| Mitigated | 9 |
| Partially Mitigated | 3 |
| High Severity | 8 |
| Medium Severity | 12 |
| Low Severity | 6 |

---

## Identified Threats (Action Required)

### High Severity

| ID | Threat | Category | Component | Priority |
|----|--------|----------|-----------|----------|
| SPOOF-001 | Unauthorized Matrix User Registration | Spoofing | Conduit | P1 |
| SPOOF-002 | Agent Identity Impersonation | Spoofing | Agent Runtime | P1 |
| TAMPER-001 | EFS Workspace Modification | Tampering | EFS Storage | P1 |
| TAMPER-002 | Agent Configuration Injection | Tampering | Fleet Manager | P1 |
| INFO-002 | Agent Memory Data Leakage | Info Disclosure | EFS Storage | P1 |
| DOS-001 | Agent Task Exhaustion | DoS | ECS Cluster | P1 |
| EOP-001 | Overly Permissive IAM Policies | Elevation | IAM | P1 |

### Medium Severity

| ID | Threat | Category | Component | Priority |
|----|--------|----------|-----------|----------|
| TAMPER-003 | Container Image Tampering | Tampering | ECR | P2 |
| REPUD-001 | Insufficient Agent Action Logging | Repudiation | Agent Runtime | P2 |
| INFO-004 | Matrix Room Membership Disclosure | Info Disclosure | Conduit | P2 |
| DOS-002 | EFS Storage Exhaustion | DoS | EFS | P2 |
| DOS-003 | Matrix Message Flood | DoS | Conduit | P2 |
| EOP-003 | Agent Tool Abuse | Elevation | OpenClaw | P2 |

### Partially Mitigated

| ID | Threat | Category | Component | Notes |
|----|--------|----------|-----------|-------|
| SPOOF-003 | Stolen Access Token Reuse | Spoofing | Matrix Protocol | Container isolation helps |
| REPUD-002 | CloudWatch Log Gaps | Repudiation | CloudWatch | Logs exist but short retention |
| INFO-001 | Fleet Secret Exposure in Logs | Info Disclosure | Fleet Manager | Truncated but visible |

---

## Mitigated Threats

### Infrastructure Mitigations

| ID | Threat | Category | Mitigation | Verification |
|----|--------|----------|------------|--------------|
| SPOOF-004 | Fleet Secret Compromise | Spoofing | AWS Secrets Manager with IAM controls | ✅ CDK deployment |
| TAMPER-004 | Matrix Message Modification | Tampering | Event hashing, EFS encryption, no federation | ✅ Conduit config |
| INFO-003 | Bedrock API Key Exposure | Info Disclosure | IAM task roles, no hardcoded keys | ✅ CDK deployment |
| EOP-002 | Container Escape | Elevation | Fargate microVM isolation | ✅ Architecture |
| REPUD-003 | Matrix Message Audit Trail | Repudiation | Persistent Conduit DB on EFS | ✅ Architecture |

### Docker Compose Related (Local Development Only)

> ⚠️ **Note**: The following threats are present in `docker-compose.yml` but are **MITIGATED** because docker-compose.yml is used exclusively for **local development** and is **NOT deployed to ECS/cloud environments**.

| ID | Threat | Category | File | Production Alternative |
|----|--------|----------|------|----------------------|
| SPOOF-005 | Docker Compose Weak Passwords | Spoofing | docker-compose.yml | Secrets Manager + HMAC derivation |
| TAMPER-005 | Docker Compose Volume Exposure | Tampering | docker-compose.yml | EFS with IAM controls |
| INFO-005 | Docker Compose AWS Credentials | Info Disclosure | docker-compose.yml | IAM task roles |
| DOS-004 | Docker Compose Resource Limits | DoS | docker-compose.yml | ECS task definitions |
| EOP-004 | Docker Compose Root Access | Elevation | docker-compose.yml | Fargate isolation |

---

## Action Items by Sprint

### Sprint 1 (Immediate)
- [ ] SPOOF-001: Implement registration token for Conduit
- [ ] TAMPER-001: Create separate EFS access points per agent
- [ ] INFO-001: Remove secret value logging
- [ ] EOP-001: Restrict Bedrock to specific model ARNs

### Sprint 2
- [ ] SPOOF-002: Add per-agent salt to password derivation
- [ ] TAMPER-002: Implement config signature verification
- [ ] DOS-001: Add MAX_AGENTS quota to Fleet Manager
- [ ] REPUD-001: Implement structured JSON logging

### Sprint 3
- [ ] INFO-002: Implement workspace read-only mounting
- [ ] INFO-004: Change room preset to private_chat
- [ ] DOS-002: Configure EFS Infrequent Access tier
- [ ] DOS-003: Implement message rate limiting

### Sprint 4
- [ ] TAMPER-003: Implement container image signing
- [ ] SPOOF-003: Implement token rotation policy
- [ ] REPUD-002: Increase log retention to 90 days
- [ ] EOP-003: Implement tool allowlisting per role

---

## Verification Checklist

### Mitigated Threats Verification

| ID | Mitigation | Verified | Evidence |
|----|------------|----------|----------|
| SPOOF-004 | Secrets Manager | ✅ | `secrets-construct.ts` |
| SPOOF-005 | Local dev only | ✅ | Documentation |
| TAMPER-004 | EFS encryption | ✅ | `transitEncryption: 'ENABLED'` |
| TAMPER-005 | Local dev only | ✅ | Documentation |
| REPUD-003 | EFS persistence | ✅ | Architecture |
| INFO-003 | IAM roles | ✅ | No API keys in code |
| INFO-005 | Local dev only | ✅ | Documentation |
| DOS-004 | Local dev only | ✅ | Documentation |
| EOP-002 | Fargate | ✅ | Architecture |
| EOP-004 | Local dev only | ✅ | Documentation |

### Open Threats Review Schedule

| ID | Next Review | Owner | Notes |
|----|-------------|-------|-------|
| SPOOF-001 | Sprint 1 | Security Team | High priority |
| SPOOF-002 | Sprint 2 | Security Team | Depends on SPOOF-001 |
| TAMPER-001 | Sprint 1 | Platform Team | Requires EFS changes |
| DOS-001 | Sprint 2 | Platform Team | Config change |

---

## Risk Acceptance Log

Threats accepted without full mitigation:

| ID | Accepted By | Date | Rationale | Review Date |
|----|-------------|------|-----------|-------------|
| (none currently) | | | | |

---

## Change History

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-07 | 1.0 | Initial threat model creation |
