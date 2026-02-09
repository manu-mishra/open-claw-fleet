# Open-Claw-Fleet AWS Infrastructure

AWS CDK infrastructure for deploying OpenClaw AI agents at scale.

## Architecture

See [AWS Architecture Documentation](../../../docs/aws-architecture.md) for detailed design.

### Stack Organization

**Shared Infrastructure (Deploy Once):**
- `NetworkStack` - VPC, subnets, NAT gateway, VPC endpoints
- `EcrStack` - Container repositories (agent, conduit, element)
- `EfsStack` - Persistent storage for agents and Conduit
- `BastionStack` - Jump host for secure access

**Per Environment:**
- `ClusterStack` - ECS cluster with Fargate capacity
- `ConduitStack` - Matrix homeserver service
- `ElementStack` - Web UI with internal ALB

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Deploy shared infrastructure
npm run deploy:shared

# Deploy dev environment
npm run deploy:dev

# Access Element UI (see deployment guide)
```

## Configuration

Environment settings in `lib/config/environment.ts`:

```typescript
dev: {
  agentCount: 2,
  cpu: 256,
  memory: 512
}
```

## Deployment

See [Deployment Guide](../../../docs/deployment-guide.md) for detailed instructions.

### Deploy Everything

```bash
npm run deploy:all
```

### Deploy Specific Environment

```bash
npm run deploy:dev
npm run deploy:staging
npm run deploy:prod
```

### Destroy Environment

```bash
npm run destroy:dev
```

## Stack Dependencies

```
EcrStack (shared)
NetworkStack (per env)
EfsStack (per env) → NetworkStack
BastionStack (per env) → NetworkStack
ClusterStack (per env) → NetworkStack
ConduitStack (per env) → ClusterStack, EfsStack
ElementStack (per env) → ClusterStack, ConduitStack
```

## Outputs

Each stack exports values for cross-stack references:

- **NetworkStack:** VPC ID, subnet IDs
- **EcrStack:** Repository URIs
- **EfsStack:** File system ID
- **ClusterStack:** Cluster name, ARN
- **ConduitStack:** Service name, internal URL
- **ElementStack:** ALB DNS name

## Development

```bash
# Compile TypeScript
npm run build

# Synthesize CloudFormation
npm run synth

# Watch mode
npm run watch
```

## Troubleshooting

See [Deployment Guide - Troubleshooting](../../../docs/deployment-guide.md#troubleshooting)
