# Project Structure

## Delegation Rules

**Use `devopsagent` subagent for:**
- Modifying infrastructure code in `/infra`
- Running `cdk deploy`, `cdk synth`, `cdk diff`
- Any CDK or infrastructure build tasks

**Use default subagent for:**
- Docker builds and container operations
- Deployment scripts
- Other long-running build tasks

This keeps the main conversation responsive and prevents context bloat.

## Repository Layout

```
open-claw-fleet/
├── .kiro/              # Kiro configuration and steering
├── infra/              # AWS CDK infrastructure code
├── packages/           # Workspace packages (future agent configs)
├── sample/             # Reference implementations
│   └── openclaw/       # Complete OpenClaw implementation
├── scripts/            # Deployment and utility scripts
├── docker/             # Docker configurations
├── docs/               # Generated documentation
└── todo/               # Planning documents
```

## Key Directories

### `/infra` - Infrastructure as Code
Primary development area for AWS CDK stack definitions.

- `bin/` - CDK app entry point
- `lib/` - Stack definitions and constructs
  - `open-claw-fleet-stack.ts` - Main stack (currently empty, to be populated)
- `cdk.json` - CDK configuration
- `tsconfig.json` - TypeScript configuration

**Purpose**: Define and deploy AWS infrastructure (ECS, VPC, EFS, IAM, etc.)

### `/sample/openclaw` - Reference Implementation
Complete OpenClaw agent implementation for reference. This is a full-featured autonomous AI agent framework.

**Key subdirectories**:
- `src/` - Core TypeScript source code
- `extensions/` - Platform integrations (Discord, Slack, Telegram, etc.)
- `skills/` - Agent capabilities and tools
- `apps/` - Mobile/desktop applications (iOS, Android, macOS)
- `docs/` - OpenClaw documentation
- `scripts/` - Build and deployment scripts

**Note**: This is reference material. Fleet-specific agent configurations will go in `/packages`.

### `/packages` - Agent Configurations
Currently empty. Will contain:
- Agent role templates (CEO, VP, Manager, etc.)
- Custom agent configurations
- Shared utilities for fleet management

### `/scripts` - Utilities
Deployment scripts, automation, and helper tools for fleet management.

### `/docker` - Containerization
Docker configurations for local development and testing.

## Workspace Configuration

The project uses npm workspaces with two main packages:
1. `infra` - Infrastructure code
2. Future packages in `/packages` directory

## Documentation

- `/docs` - Generated TypeDoc documentation for infrastructure
- `/sample/openclaw/docs` - OpenClaw framework documentation
- Root `README.md` - Project overview and getting started

## Development Focus

Current development centers on `/infra` directory, building out the CDK stack to support:
- ECS cluster for agent containers
- VPC and networking
- EFS for persistent storage
- IAM roles and policies
- CloudWatch monitoring

Agent deployment workflows and configurations will be added to `/packages` as infrastructure matures.
