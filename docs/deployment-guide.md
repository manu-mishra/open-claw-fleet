# Open-Claw-Fleet Deployment Guide

## Prerequisites

- AWS CLI + Session Manager Plugin (used by `fleet-connect`; no manual CLI steps)
- AWS CDK CLI: `npm install -g aws-cdk`
- Docker installed and running
- Node.js ≥ 20.0.0
- AWS Session Manager Plugin for port forwarding

## Quick Start

### 1. Deploy Infrastructure

```bash
# From project root
./scripts/deploy-aws-env.sh
```

This script will:
- Build all Docker images (agent, conduit, element, fleet-manager)
- Push images to ECR
- Deploy shared stack (ECR repositories)
- Deploy dev stack (VPC, ECS, services)
- All services start at `desiredCount: 1`
- Fleet Manager handles agent lifecycle (no manual scaling required)

### 2. Connect to Element UI

Use the fleet-connect tool to establish port forwarding:

```bash
# From project root
npm run fleet:connect
```

This will:
- Automatically find bastion, Conduit, and Element IPs
- Start port forwarding for both services:
  - Conduit: `localhost:6167`
  - Element: `localhost:8080`
- Keep connections alive until you press Ctrl+C

Then open your browser to: **http://localhost:8080**

You'll see the **Open-Claw-Fleet-Command-Center** login screen with custom branding.

---

## Accessing Services

### Element Web UI (Matrix Interface)

**Recommended Method:** Use the fleet-connect tool (see Quick Start step 2)

**Note:** `fleet-connect` is the supported access path.

### Fleet Connect Tool

The `fleet-connect` tool simplifies access by automatically:
- Finding bastion and service IPs
- Starting both port forwards in one process
- Handling cleanup on exit

**Usage:**
```bash
npm run fleet:connect
```

**Features:**
- Single command to connect to all services
- Automatic service discovery
- Graceful shutdown with Ctrl+C
- Clear status messages

**What it connects:**
- Conduit (Matrix homeserver): `localhost:6167`
- Element (Web UI): `localhost:8080`

**Source:** `packages/tools/fleet-connect/`


## Troubleshooting

### Container Issues

- Use CloudWatch Logs in the AWS Console. Log groups: `/ecs/conduit-dev`, `/ecs/element-dev`, `/ecs/fleet-manager-dev`, `/ecs/agent-dev`.
- Verify services are healthy in the ECS console for `open-claw-fleet-dev`.

### Common Fixes

- **Build failures**: Ensure `npm run build` completes successfully
- **ECR push denied**: Verify AWS credentials and ECR repositories exist
- **Agent startup fails**: Check `FLEET_SECRET` environment variable
- **Matrix connection issues**: Verify network connectivity between containers
- **Fleet connect fails**: Ensure bastion security groups and SSM permissions allow access

### Resource Cleanup

- Use the provided cleanup script: `./scripts/destroy-aws-env.sh`
- Remove ECR images via the AWS Console if needed
