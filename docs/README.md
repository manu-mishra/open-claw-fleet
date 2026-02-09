# Open-Claw-Fleet Documentation

Production-grade documentation for deploying autonomous AI agents on AWS.

## Quick Links

- [Getting Started](#getting-started)
- [Architecture](architecture.md)
- [Deployment Guide](deployment-guide.md)
- [AWS Setup](aws-environment-setup.md)

## Getting Started

### Prerequisites

- AWS Account with appropriate permissions
- Node.js ≥ 20.0.0
- AWS CDK CLI: `npm install -g aws-cdk`
- Docker (for local testing)
- AWS CLI + Session Manager Plugin (required by `fleet-connect`)

### Local Development

```bash
# Clone and install
git clone https://github.com/manu-mishra/open-claw-fleet.git
cd open-claw-fleet
npm install

# Build packages
npm run build

# Start local environment
cd config/environments/local
docker compose up -d
```

### AWS Deployment

```bash
# Deploy infrastructure (shared + dev) with one command
./scripts/deploy-aws-env.sh
```

Fleet Manager handles agent lifecycle once deployed. See `docs/aws-environment-setup.md` for environment details.

## Documentation Structure

### Core Documentation

- **[Architecture](architecture.md)** - System design, components, and data flow
- **[Deployment Guide](deployment-guide.md)** - Step-by-step deployment instructions
- **[AWS Setup](aws-environment-setup.md)** - AWS-specific configuration and secrets management

### Reference

- **[Docker Images](docker-images.md)** - Container build and management

## Key Concepts

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    AWS ECS Cluster                       │
│                                                           │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Conduit (Matrix Server)                          │  │
│  │  - Service Discovery: conduit.anycompany.corp      │  │
│  │  - Persistent storage: EFS                        │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↑                                │
│                          │                                │
│  ┌──────────────────────┴───────────────────────────┐  │
│  │  Agent Tasks (On-Demand)                          │  │
│  │  - Fargate tasks with ARM64                       │  │
│  │  - Isolated EFS directories                       │  │
│  │  - Secrets from Secrets Manager                   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Components

- **Conduit**: Matrix homeserver for agent communication
- **Element**: Web UI for Matrix (debugging)
- **Agents**: OpenClaw AI agents running as Fargate tasks
- **Fleet Manager**: Orchestrates agent lifecycle

### Environments

- **Local**: Docker Compose for development
- **AWS**: ECS Fargate for production

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/manu-mishra/open-claw-fleet/issues)
- Documentation: [Full docs](https://github.com/manu-mishra/open-claw-fleet/tree/main/docs)

## License

MIT License - see [LICENSE](../LICENSE) file for details.
