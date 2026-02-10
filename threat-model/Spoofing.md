# Spoofing Threats

> **Category:** Identity-related threats  
> **Last Updated:** 2026-02-07

Spoofing threats involve an attacker pretending to be something or someone other than themselves. In Open-Claw-Fleet, this primarily concerns Matrix authentication, agent identity, and credential management.

---

## SPOOF-001

### Unauthorized Matrix User Registration

| Attribute | Value |
|-----------|-------|
| **Threat ID** | SPOOF-001 |
| **STRIDE Category** | Spoofing |
| **Severity** | 🔴 High |
| **Status** | 🔴 Identified |
| **Likelihood** | High |
| **Impact** | High |

#### Description

The Conduit Matrix server has open registration enabled (`allow_registration = true`), allowing anyone with network access to register arbitrary Matrix users. An attacker could register users that impersonate legitimate agents or create malicious users to infiltrate agent communication channels.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Conduit Configuration | `docker-files/conduit.toml` |
| AWS Conduit Config | `docker-files/aws/conduit.toml` |

#### Attack Vector

1. Attacker gains access to internal network (via compromised bastion or insider)
2. Attacker registers Matrix user with a name similar to legitimate agent
3. Attacker joins organization rooms and receives sensitive communications
4. Attacker sends messages impersonating legitimate agents

#### Current Configuration

```toml
# docker-files/conduit.toml
[global]
allow_registration = true
```

#### Recommended Mitigations

1. **Implement registration token**: Require a shared secret for registration
2. **Rate limit registration**: Limit registration attempts per IP/time window
3. **Monitor registration events**: Alert on unexpected user registrations
4. **Implement user approval workflow**: Require admin approval for new users

#### References

- `docker-files/conduit.toml:7`
- `docs/ARCHITECTURE.md` - Matrix Homeserver section

---

## SPOOF-002

### Agent Identity Impersonation

| Attribute | Value |
|-----------|-------|
| **Threat ID** | SPOOF-002 |
| **STRIDE Category** | Spoofing |
| **Severity** | 🔴 High |
| **Status** | 🔴 Identified |
| **Likelihood** | Medium |
| **Impact** | High |

#### Description

Agent passwords are derived deterministically from the Matrix ID and fleet secret. If an attacker obtains the fleet secret, they can derive the password for any agent and authenticate as that agent.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Agent Runtime | `packages/setup/agent-runtime/src/index.ts` |
| Fleet Manager | `packages/setup/fleet-manager/src/index.ts` |

#### Attack Vector

1. Attacker obtains fleet secret (via log exposure, EFS access, or insider)
2. Attacker calculates `HMAC-SHA256(fleetSecret, matrixId).slice(0, 32)`
3. Attacker authenticates as any agent
4. Attacker accesses agent conversations and performs actions as that agent

#### Vulnerable Code

```typescript
// packages/setup/agent-runtime/src/index.ts:13-15
function derivePassword(matrixId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(matrixId).digest('hex').slice(0, 32);
}
```

#### Recommended Mitigations

1. **Add per-agent salt**: Include unique salt in password derivation
2. **Implement MFA for agents**: Add secondary authentication factor
3. **Secret rotation policy**: Implement automatic secret rotation
4. **Anomaly detection**: Monitor for unusual agent activity patterns

#### References

- `packages/setup/agent-runtime/src/index.ts:13-15`
- `packages/setup/fleet-manager/src/index.ts:504-508`
- `docs/findings/agent-deployment.md` - Password Derivation section

---

## SPOOF-003

### Stolen Access Token Reuse

| Attribute | Value |
|-----------|-------|
| **Threat ID** | SPOOF-003 |
| **STRIDE Category** | Spoofing |
| **Severity** | 🟠 Medium |
| **Status** | 🟡 Partially Mitigated |
| **Likelihood** | Low |
| **Impact** | High |

#### Description

Matrix access tokens are long-lived and stored in memory and configuration files. If an attacker obtains a valid access token, they can impersonate the associated user until the token is revoked.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Agent Runtime | `packages/setup/agent-runtime/src/index.ts` |
| OpenClaw Config | `/root/.openclaw/openclaw.json` (runtime) |

#### Attack Vector

1. Attacker gains access to container filesystem or memory
2. Attacker extracts access token from config or process memory
3. Attacker uses token to authenticate as agent from external location
4. Legitimate agent may not detect impersonation

#### Current State

```typescript
// packages/setup/agent-runtime/src/index.ts:129-130
config.channels.matrix.accessToken = token;
// Token written to /root/.openclaw/openclaw.json
```

#### Partial Mitigation

- Tokens stored only within container filesystem
- Container isolation prevents cross-container access
- No persistent storage of tokens outside container

#### Recommended Additional Mitigations

1. **Token rotation**: Implement periodic token refresh
2. **Token binding**: Bind tokens to container identity
3. **Short-lived tokens**: Request tokens with limited validity
4. **Device verification**: Implement Matrix device verification

#### References

- `packages/setup/agent-runtime/src/index.ts:129-147`

---

## SPOOF-004

### Fleet Secret Compromise

| Attribute | Value |
|-----------|-------|
| **Threat ID** | SPOOF-004 |
| **STRIDE Category** | Spoofing |
| **Severity** | 🟠 Medium |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | High |

#### Description

The fleet secret is the master key for deriving all agent passwords. Compromise of this secret would allow an attacker to impersonate any agent in the fleet.

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Secrets Construct | `packages/aws/infra/lib/constructs/secrets-construct.ts` |
| Agent Task Construct | `packages/aws/infra/lib/constructs/agent-task-construct.ts` |

#### Mitigation Details

The fleet secret is stored in AWS Secrets Manager with the following controls:

1. **IAM Access Control**: Only specific task roles can read the secret
2. **Encryption**: Secret encrypted at rest with AWS KMS
3. **Audit Trail**: All access logged via CloudTrail
4. **Rotation Support**: Secrets Manager supports automatic rotation

```typescript
// packages/aws/infra/lib/constructs/secrets-construct.ts:17-26
this.fleetSecret = new secretsmanager.Secret(this, 'FleetSecret', {
  secretName: `openclaw/${props.environment}/fleet-secret`,
  description: 'Master secret for deriving agent passwords',
  generateSecretString: {
    secretStringTemplate: JSON.stringify({}),
    generateStringKey: 'secret',
    excludePunctuation: true,
    passwordLength: 32,
  },
});
```

#### IAM Policy Restriction

```typescript
// packages/aws/infra/lib/constructs/agent-task-construct.ts:59-65
executionRole.addToPolicy(new iam.PolicyStatement({
  actions: ['secretsmanager:GetSecretValue'],
  resources: [
    `arn:aws:secretsmanager:${region}:${account}:secret:openclaw/${env}/fleet-secret*`,
  ],
}));
```

#### References

- `packages/aws/infra/lib/constructs/secrets-construct.ts:17-26`
- `packages/aws/infra/lib/constructs/agent-task-construct.ts:59-65`

---

## SPOOF-005

### Docker Compose Weak Passwords

| Attribute | Value |
|-----------|-------|
| **Threat ID** | SPOOF-005 |
| **STRIDE Category** | Spoofing |
| **Severity** | 🟡 Low |
| **Status** | 🟢 Mitigated |
| **Likelihood** | Low |
| **Impact** | Medium |

#### Description

The Docker Compose configuration includes hardcoded weak passwords for agent authentication (`AGENT_PASSWORD: agent123`).

#### Affected Components

| Component | File Location |
|-----------|---------------|
| Docker Compose | `docker-files/docker-compose.yml` |

#### Vulnerable Configuration

```yaml
# docker-files/docker-compose.yml:34
AGENT_PASSWORD: agent123
```

#### Mitigation Details

> ⚠️ **MITIGATED**: This docker-compose.yml is used exclusively for **local development** and is **NOT deployed to ECS/cloud environments**.

**Mitigation Notes:**
1. Docker Compose is only used for local development testing
2. Production deployment uses AWS ECS with Secrets Manager
3. Production passwords are derived from fleet secret (see SPOOF-004)
4. Local network access required to exploit this vulnerability
5. No sensitive data in local development environment

#### Production Alternative

In AWS ECS deployment, passwords are:
- Derived from fleet secret using HMAC-SHA256
- Never hardcoded in configuration
- Injected via ECS Secrets integration

#### References

- `docker-files/docker-compose.yml:27-55`
- `docs/ARCHITECTURE.md` - Container Infrastructure section
