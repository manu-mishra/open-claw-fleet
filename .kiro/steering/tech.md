# Technology Stack

## Delegation Requirements

**Use `devopsagent` subagent for these tasks:**
- Modifying any code in `/infra` directory
- `cdk deploy`, `cdk synth`, `cdk diff` operations
- `npm run build` and other build commands in `/infra`

**Use default subagent for:**
- `docker build`, `docker run`, `docker-compose` commands
- Any command that takes >10 seconds

## Infrastructure

- **Language**: TypeScript
- **IaC Framework**: AWS CDK (Cloud Development Kit) v2
- **Target Platform**: AWS (ECS, VPC, EFS, IAM, CloudWatch)
- **Node Version**: ≥20.0.0 (OpenClaw requires ≥22.12.0)
- **Package Manager**: npm (workspace root), pnpm (OpenClaw sample)

## Build System

### Root Project
- **Workspaces**: npm workspaces for monorepo structure
- **TypeScript**: v5.9.3
- **Compiler Target**: ES2022, NodeNext module resolution

### Infrastructure (`/infra`)
- **CDK Version**: 2.1101.0
- **TypeScript Config**: Strict mode enabled, ES2022 target
- **Documentation**: TypeDoc for API docs

### OpenClaw Sample (`/sample/openclaw`)
- **Package Manager**: pnpm v10.23.0
- **Build Tool**: TypeScript compiler + custom scripts
- **Testing**: Vitest with coverage (70% threshold)
- **Linting**: oxlint with type-aware checking
- **Formatting**: oxfmt

## Common Commands

### Infrastructure Development
```bash
# From /infra directory
npm run build          # Compile TypeScript
npm run watch          # Watch mode compilation
npx cdk deploy         # Deploy stack to AWS
npx cdk diff           # Compare deployed vs current
npx cdk synth          # Generate CloudFormation template
npm run docs           # Generate TypeDoc documentation
```

### Root Project
```bash
npm install            # Install all workspace dependencies
```

### OpenClaw Reference (if working with sample)
```bash
# From /sample/openclaw directory
pnpm build             # Build TypeScript
pnpm test              # Run unit tests
pnpm lint              # Lint code
pnpm format:fix        # Auto-fix formatting
pnpm dev               # Run in development mode
```

## AWS Prerequisites

- AWS CLI configured with credentials
- AWS CDK CLI installed globally: `npm install -g aws-cdk`
- First-time setup: `cdk bootstrap` (in target AWS account/region)
- Docker installed for local testing

## Key Dependencies

### Infrastructure
- `aws-cdk-lib`: ^2.234.1
- `constructs`: ^10.0.0

### OpenClaw (Reference)
- `@mariozechner/pi-agent-core`: Agent framework
- `@whiskeysockets/baileys`: WhatsApp integration
- `grammy`: Telegram bot framework
- `@slack/bolt`: Slack integration
- `playwright-core`: Browser automation
- `sqlite-vec`: Vector storage for memory
