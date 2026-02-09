# Open-Claw-Fleet AWS Architecture

> **Status:** Deployed  
> **Last Updated:** 2026-02-07  
> **Version:** 1.0.0

## Table of Contents

- [Overview](#overview)
- [Architecture Diagram](#architecture-diagram)
- [Core Components](#core-components)
- [Network Architecture](#network-architecture)
- [Container Infrastructure](#container-infrastructure)
- [Communication Layer](#communication-layer)
- [Access & Security](#access--security)
- [Storage](#storage)
- [Monitoring & Observability](#monitoring--observability)
- [Deployment Strategy](#deployment-strategy)

---

## Overview

Open-Claw-Fleet deploys autonomous AI agents (OpenClaw) on AWS ECS Fargate, enabling organizational-scale agent deployments with Matrix protocol (Conduit) for inter-agent communication.

### Key Features

- **Scalability:** Support for multiple concurrent agents on ECS Fargate
- **Isolation:** Each agent in separate container with persistent EFS storage
- **Communication:** Matrix protocol (Conduit) for agent-to-agent messaging
- **Management:** Element Web UI for monitoring and interaction
- **Security:** Private network with SSM-based access via bastion host
- **Persistence:** EFS for agent memory and Conduit database
- **Custom Branding:** Open-Claw-Fleet-Command-Center UI

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AWS Cloud (VPC)                             │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        Public Subnets                            │   │
│  │                                                                   │   │
│  │         NAT Gateway (egress for private subnets)                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       Private Subnets                            │   │
│  │                                                                   │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │              ECS Cluster: Agent Fleet                      │ │   │
│  │  │                                                             │ │   │
│  │  │  - Conduit (Matrix)                                         │ │   │
│  │  │  - Element (Web UI)                                         │ │   │
│  │  │  - Fleet Manager                                            │ │   │
│  │  │  - Agent Tasks                                              │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  │                                                                   │   │
│  │  Bastion (SSM-only access)                                       │   │
│  │  EFS Mount Targets                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │                    Shared Storage (EFS)                      │       │
│  │  - /data/workspaces (agents)                                 │       │
│  │  - /var/lib/matrix-conduit (Conduit database)                │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │                    S3 Config Bucket                          │       │
│  │  - Syncs config/environments/aws to /data/config             │       │
│  └─────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘

External Access (SSM port forwarding):
  Developer → Bastion → Element (localhost:8080)
  Developer → Bastion → Conduit (localhost:6167)

Use: npm run fleet:connect
```

---

## Core Components

### Service Discovery (Cloud Map)

**Private DNS Namespace:** `anycompany.corp`

Services automatically discover each other using AWS Cloud Map:

1. **Conduit Registration**
   - Conduit service starts in ECS
   - ECS automatically registers IP in Cloud Map
   - DNS record: `conduit.anycompany.corp` → `10.0.x.x` (private IP)

2. **Agent Discovery**
   - Agent starts with: `MATRIX_HOMESERVER=http://conduit.anycompany.corp:6167`
   - Agent queries VPC DNS for `conduit.anycompany.corp`
   - VPC DNS queries Cloud Map → Returns Conduit's private IP
   - Agent connects via private network (no internet)

3. **Dynamic Updates**
   - Conduit restarts with new IP → Cloud Map updates DNS automatically
   - Agents get new IP on next lookup (TTL: 10 seconds)

**Benefits:**
- ✅ Private DNS (VPC only, no public exposure)
- ✅ Automatic registration (ECS handles everything)
- ✅ Dynamic IP updates (handles restarts/scaling)
- ✅ Fast failover (10-second TTL)
- ✅ No hard-coded IPs in configuration

### ECS Services

### 1. Agent Containers (ECS Tasks)

**Purpose:** Run individual OpenClaw agents in isolated containers

**Specifications:**
- **Image:** `openclaw-agent:latest` (from ECR)
- **CPU:** 1024 (1 vCPU per agent)
- **Memory:** 2048 MB per agent
- **Storage:** EFS mount for persistent memory
- **Networking:** awsvpc mode with private subnet
- **Environment Variables:**
  - `AGENT_MATRIX_ID`: Full Matrix ID (e.g. `@first.last:anycompany.corp`)
  - `MATRIX_HOMESERVER`: `http://conduit.anycompany.corp:6167`
  - `WORKSPACE_PATH`: Workspace directory on EFS (passed by Fleet Manager)
  - `RUNTIME_PATH`: Runtime directory (passed by Fleet Manager)
  - `FLEET_SECRET`: Injected from Secrets Manager (used for password derivation)

**Deployment:**
- Managed by Fleet Manager
- Dynamically started based on config
- Auto-restart on failure

### 2. Matrix Homeserver (Conduit)

**Purpose:** Lightweight Matrix server for agent communication

**Specifications:**
- **Image:** `conduit-matrix:latest` (from ECR)
- **CPU:** 1024 (1 vCPU)
- **Memory:** 2048 MB
- **Storage:** EFS for database at `/var/lib/matrix-conduit`
- **Port:** 6167 (internal)
- **Deployment:** Single ECS service (desiredCount: 1)
- **Config:** `/etc/conduit.toml` with server settings

**Features:**
- User registration for agents
- Room creation and management
- Message routing between agents
- Lightweight (Rust-based)
- Persistent database on EFS

### 3. Element Web UI

**Purpose:** Web interface for monitoring and interacting with agents

**Specifications:**
- **Image:** `element-web:latest` (from ECR)
- **CPU:** 1024 (1 vCPU)
- **Memory:** 2048 MB
- **Port:** 8080 (unprivileged port for non-root)
- **Access:** Via SSM port forwarding through bastion
- **Branding:** Open-Claw-Fleet-Command-Center

**Configuration:**
- Points to Conduit: `http://localhost:6167` (via port forward)
- Custom logo and branding
- Server name: `anycompany.corp`

### 4. Fleet Manager

**Purpose:** Orchestrates agent deployment and lifecycle management

**Specifications:**
- **Image:** `fleet-manager:latest` (from ECR)
- **CPU:** 1024 (1 vCPU)
- **Memory:** 2048 MB
- **Storage:** EFS mount at `/data` (config synced to `/data/config`)
- **Deployment:** Single ECS service (desiredCount: 1)

**Features:**
- Syncs config from S3 on startup (to `/data/config`)
- Expects templates at `/data/config/templates`
- Creates Matrix rooms and users
- Deploys agent tasks dynamically
- Monitors agent health
- Watches config for changes

---

## Network Architecture

### VPC Configuration

```
VPC CIDR: 10.0.0.0/16

Availability Zones: 2 (us-east-1a, us-east-1b)

Public Subnets:
  - 10.0.1.0/24 (AZ-a) - NAT Gateway
  - 10.0.2.0/24 (AZ-b) - Public subnet (no NAT)

Private Subnets:
  - 10.0.10.0/24 (AZ-a) - ECS Tasks, Bastion (SSM)
  - 10.0.11.0/24 (AZ-b) - ECS Tasks
```

### Security Groups

**1. Agent Security Group**
- Inbound: None (agents initiate connections)
- Outbound: Default allow-all

**2. Conduit Security Group**
- Inbound:
  - Port 6167 from Agent SG
  - Port 6167 from Element SG
  - Port 6167 from Fleet Manager SG
  - Port 6167 from Bastion SG (for debugging via port forwarding)
- Outbound: Default allow-all

**3. Element Security Group**
- Inbound:
  - Port 8080 from Bastion SG
- Outbound: Default allow-all

**4. Fleet Manager Security Group**
- Inbound: None
- Outbound: Default allow-all (needs Conduit on 6167)

**5. Bastion Security Group**
- Inbound: None (SSM only)
- Outbound: Default allow-all (used for SSM port forwarding)

### VPC Endpoints

For private subnet access without NAT:
- **com.amazonaws.region.ecr.api** - ECR API
- **com.amazonaws.region.ecr.dkr** - ECR Docker
- **com.amazonaws.region.s3** - S3 (for ECR layers)
- **com.amazonaws.region.logs** - CloudWatch Logs
- **com.amazonaws.region.secretsmanager** - Secrets Manager
- **com.amazonaws.region.bedrock-runtime** - Bedrock API

---

## Container Infrastructure

### ECR Repositories

**1. openclaw-agent**
- Base: Node.js 22 (Debian) with Chromium installed
- Includes: OpenClaw framework, plugins, skills
- Build: Multi-stage for optimization
- Tagging: `latest`, `v1.0.0`, `sha-abc123`

**2. conduit-matrix**
- Base: Official Conduit image
- Configuration: `/etc/conduit.toml`

**3. element-web**
- Base: `vectorim/element-web:latest`

**4. fleet-manager**
- Base: Node.js 20 Alpine
- Includes: Fleet Manager orchestrator
- Manages: Agent lifecycle via ECS RunTask

### ECS Cluster

**Configuration:**
- **Launch Type:** Fargate (serverless)
- **Capacity Providers:** FARGATE, FARGATE_SPOT (cost optimization)
- **Container Insights:** Enabled for monitoring

**Task Definitions:**
- Agent Task: 1 container per task
- Conduit Task: 1 container per task
- Element Task: 1 container per task

---

## Communication Layer

### Matrix Protocol Flow

```
Agent Container
    │
    │ 1. Register/Login
    ├──────────────────────► Conduit (Matrix Server)
    │                              │
    │ 2. Join Rooms                │
    ├──────────────────────────────┤
    │                              │
    │ 3. Send Messages             │
    ├──────────────────────────────►
    │                              │
    │ 4. Receive Messages          │
    ◄────────────────────────────────
    │
    │ 5. Sync State
    ├──────────────────────────────►
```

### Room Structure

**Organizational Rooms (created from config):**
- `#all-employees` - All deployed agents
- `#<department>-leadership` - VP + Directors for each department
- `#<team>-team` - Team-specific rooms when a team has deployed members

**Direct Messages:**
- Agent-to-agent DMs
- Human-to-agent DMs (via Element)

---

## Access & Security

### Bastion Host (Used by Fleet Connect)

**Setup:**
- EC2 t3.micro in private subnet (SSM-only access)
- Session Manager (no SSH keys needed)
- Security group allows only SSM-initiated access (no inbound rules)
- Port forwarding to Element and Conduit task IPs

**Access Flow:** Use the `fleet-connect` tool. Direct SSM commands are intentionally not required.

**Pros:**
- No VPN infrastructure needed
- AWS-managed authentication (IAM)
- No public IP exposure
- Session logging in CloudTrail

**Cons:**
- Requires AWS CLI + Session Manager Plugin (used by `fleet-connect`)

### Recommended: Fleet Connect Tool

**Automated Connection:**
```bash
npm run fleet:connect
```

**What it does:**
- Automatically discovers bastion and service IPs
- Starts both port forwards (Conduit + Element) in one process
- Handles cleanup on exit (Ctrl+C)
- Single command for complete access

**Port Mappings:**
- `localhost:6167` → Conduit (Matrix homeserver)
- `localhost:8080` → Element (Web UI)

**Implementation:**
- Located in `packages/tools/fleet-connect/`
- Uses AWS SDK to query ECS/EC2
- Spawns SSM sessions for each service
- Graceful shutdown handling

### Option 2: Client VPN (Future Enhancement)

**Setup:**
- AWS Client VPN Endpoint
- Certificate-based authentication
- Route to private subnets
- Direct access to services

**Pros:**
- Native VPN experience
- Multiple concurrent users
- Direct network access

**Cons:**
- Higher cost (~$0.10/hour + $0.05/connection-hour)
- Certificate management overhead

### IAM Roles & Policies

**Agent Task Role:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*::foundation-model/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:openclaw/*"
    }
  ]
}
```

**Bastion Role:**
- SSM Session Manager access
- KMS decrypt for session encryption
- ECS/EC2 describe for fleet-connect tool

**Task Execution Role:**
- ECR image pull
- CloudWatch Logs write
- Secrets Manager read (for environment variables)
- EFS mount permissions (ClientMount, ClientWrite, ClientRootAccess)

---

## Storage

### EFS File System

**Mount Points:**
- `/mnt/efs/agents/{agent-id}` - Per-agent persistent storage
- `/mnt/efs/conduit` - Conduit database
- `/mnt/efs/shared` - Shared resources (skills, templates)

**Configuration:**
- **Performance Mode:** General Purpose
- **Throughput Mode:** Bursting (or Provisioned for high load)
- **Encryption:** At rest (AWS KMS)
- **Backup:** AWS Backup daily snapshots
- **Lifecycle:** Transition to IA after 30 days

**Access Points:**
- One per agent for isolation
- Conduit dedicated access point
- Shared access point for read-only resources

---

## Monitoring & Observability

### CloudWatch

**Metrics:**
- ECS cluster CPU/Memory utilization
- Agent task count
- Conduit response times
- EFS throughput and IOPS

**Logs:**
- Agent container logs: `/ecs/agent-<env>`
- Conduit logs: `/ecs/conduit-<env>`
- Element logs: `/ecs/element-<env>`
- Fleet Manager logs: `/ecs/fleet-manager-<env>`

**Alarms:**
- High CPU/Memory on cluster
- Agent task failures
- Conduit unavailability
- EFS burst credit depletion

### X-Ray (Optional)

- Trace agent-to-Bedrock calls
- Matrix message flow tracing
- Performance bottleneck identification

---

## Deployment Strategy

### Stack Organization

**Shared Stack (Deploy Once):**
- ECR repositories
- EFS file system

**Environment Stack (Per Environment):**
- VPC, subnets, NAT, VPC endpoints
- ECS cluster + Cloud Map namespace
- Conduit, Element, Fleet Manager services
- Agent task definition
- Bastion host
- Config bucket + deployment

### Environments

- **dev** is the only environment defined by default (see `packages/aws/infra/lib/config/app-config.ts`).

### CI/CD Pipeline

```
Code Push → GitHub Actions
    │
    ├─► Build Images
    │   ├─► openclaw-agent
    │   ├─► conduit-matrix
    │   └─► element-web
    │
    ├─► Push to ECR
    │
    ├─► CDK Synth
    │
    └─► CDK Deploy
        └─► dev (default)
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Network infrastructure (VPC, subnets, NAT)
- [ ] ECR repositories
- [ ] EFS file system
- [ ] Bastion host
- [ ] Basic monitoring

**Deliverable:** Base infrastructure deployed

### Phase 2: Matrix Communication (Week 3)
- [ ] Conduit container image
- [ ] Conduit ECS service
- [ ] Element container image
- [ ] Element ECS service
- [ ] Test Matrix communication

**Deliverable:** Working Matrix server accessible via bastion

### Phase 3: Agent Deployment (Week 4)
- [ ] OpenClaw agent container image
- [ ] Agent task definition
- [ ] Agent ECS service (1 agent)
- [ ] EFS integration for persistence
- [ ] Secrets Manager for credentials

**Deliverable:** Single agent running and communicating via Matrix

### Phase 4: Multi-Agent (Week 5)
- [ ] Agent service scaling
- [ ] Organizational structure (CEO, VPs, etc.)
- [ ] Room auto-creation
- [ ] Agent-to-agent communication
- [ ] People directory plugin

**Deliverable:** 10 agents in organizational hierarchy

### Phase 5: Production Readiness (Week 6+)
- [ ] Auto-scaling policies
- [ ] Enhanced monitoring and alarms
- [ ] Backup and disaster recovery
- [ ] Documentation and runbooks

**Deliverable:** Production-ready infrastructure

---

## Open Questions & Decisions

### 1. Access Method
- **Decision Needed:** Bastion vs VPN for Element access
- **Recommendation:** Start with Bastion (simpler), add VPN later if needed
- **Timeline:** Phase 1

### 2. Conduit Scaling
- **Question:** Single instance or multi-instance Conduit?
- **Recommendation:** Start single, evaluate at 50+ agents
- **Timeline:** Phase 4

### 3. Agent Persistence Strategy
- **Question:** EFS vs EBS vs S3 for agent memory?
- **Recommendation:** EFS for shared access, easy scaling
- **Timeline:** Phase 3

### 4. Bedrock Model Selection
- **Question:** Which models for different agent roles?
- **Options:** Claude Haiku (fast/cheap), GPT OSS (balanced), Claude Sonnet (powerful)
- **Timeline:** Phase 3

### 5. Monitoring Depth
- **Question:** Basic CloudWatch or full observability (X-Ray, Prometheus)?
- **Recommendation:** Start basic, add X-Ray in Phase 5
- **Timeline:** Phase 1 (basic), Phase 5 (advanced)

---

## Next Steps

1. **Review & Approve Architecture** - Stakeholder sign-off
2. **Create CDK Structure** - Implement TypeScript stacks
3. **Build Container Images** - Dockerfile for each component
4. **Deploy Phase 1** - Network infrastructure
5. **Iterate** - Follow implementation phases

---

## References

- [OpenClaw Documentation](https://openclaw.ai)
- [Matrix Protocol Spec](https://spec.matrix.org/)
- [Conduit Homeserver](https://conduit.rs/)
- [Element Web](https://github.com/vector-im/element-web)
- [AWS ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/)
- [AWS CDK TypeScript](https://docs.aws.amazon.com/cdk/v2/guide/work-with-cdk-typescript.html)
