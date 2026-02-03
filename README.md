# Open-Claw-Fleet

> Deploy thousands of autonomous AI agents in a secure AWS containerized environment

![Open-Claw-Fleet Architecture](img/open-claw-fleet-logo.png)

Open-Claw-Fleet enables organizations to run entire teams of [OpenClaw](https://openclaw.ai) AI agents on AWS ECS, creating a scalable, autonomous workforce that operates 24/7 in isolated, secure containers.

## Overview

Open-Claw-Fleet transforms the way organizations leverage AI by deploying complete organizational structures—from C-suite executives to individual contributors—as autonomous OpenClaw agents. Each agent runs in its own containerized environment on Amazon ECS, providing isolation, scalability, and enterprise-grade security.

### What is OpenClaw?

OpenClaw is an open-source, autonomous AI agent framework that:
- Runs locally with persistent memory across sessions
- Executes real tasks (not just suggestions)
- Integrates with messaging platforms (WhatsApp, Telegram, Discord, Slack, etc.)
- Provides tool execution capabilities (shell commands, browser automation, file operations)
- Supports extensible skills through a modular plugin system

Built in TypeScript, OpenClaw operates as a conversation-first agent that can autonomously handle complex workflows, remember context, and coordinate across multiple services.

## Why Open-Claw-Fleet?

Traditional AI assistants are limited to single-user, single-session interactions. Open-Claw-Fleet scales this to organizational levels:

- **Scalability**: Deploy hundreds or thousands of agents simultaneously
- **Organizational Structure**: Mirror real company hierarchies with AI agents
- **Isolation**: Each agent runs in its own secure container
- **Persistence**: Agents maintain memory and context across restarts
- **AWS Integration**: Leverage ECS, VPC, IAM, and other AWS services for enterprise deployment
- **Cost Efficiency**: Pay only for active container time

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     AWS Cloud                           │
│                                                          │
│  ┌────────────────────────────────────────────────┐   │
│  │              Amazon ECS Cluster                 │   │
│  │                                                  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │   │
│  │  │   CEO    │  │   VP     │  │ Director │     │   │
│  │  │  Agent   │  │  Agent   │  │  Agent   │     │   │
│  │  └──────────┘  └──────────┘  └──────────┘     │   │
│  │                                                  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │   │
│  │  │ Manager  │  │Developer │  │   HR     │     │   │
│  │  │  Agent   │  │  Agent   │  │  Agent   │     │   │
│  │  └──────────┘  └──────────┘  └──────────┘     │   │
│  │                                                  │   │
│  │  Each container runs OpenClaw with:            │   │
│  │  - Persistent EFS storage                       │   │
│  │  - Messaging platform connections               │   │
│  │  - Role-specific skills and permissions         │   │
│  └────────────────────────────────────────────────┘   │
│                                                          │
│  ┌────────────────────────────────────────────────┐   │
│  │         Supporting Infrastructure               │   │
│  │  - VPC with private/public subnets              │   │
│  │  - Application Load Balancer                    │   │
│  │  - EFS for persistent agent memory              │   │
│  │  - CloudWatch for monitoring & logs             │   │
│  │  - Secrets Manager for credentials              │   │
│  └────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Use Cases

### Organizational Hierarchy

Deploy a complete company structure as AI agents:

- **Executive Layer**: CEO agent for strategic decisions and oversight
- **Management Layer**: VP and Director agents for departmental coordination
- **Operational Layer**: Manager agents for team leadership
- **Individual Contributors**: Developer, analyst, and specialist agents
- **Support Functions**: HR, Legal, Finance, and Operations agents

### Department Examples

**Engineering Department**
- VP of Engineering (coordinates all engineering efforts)
- Engineering Managers (oversee specific teams)
- Developer Agents (write code, review PRs, fix bugs)
- DevOps Agents (manage deployments, monitor infrastructure)

**Legal Department**
- General Counsel (strategic legal oversight)
- Contract Review Agents (analyze agreements)
- Compliance Agents (monitor regulatory requirements)

**Human Resources**
- HR Director (workforce planning)
- Recruiting Agents (candidate screening)
- Onboarding Agents (new hire processes)

## Features

- **Container-Based Deployment**: Each agent runs in isolated ECS containers
- **Persistent Memory**: EFS-backed storage ensures agents remember context across restarts
- **Multi-Channel Communication**: Agents connect to Slack, Discord, email, and other platforms
- **Role-Based Access**: IAM policies and security groups enforce agent permissions
- **Auto-Scaling**: Scale agent count based on workload
- **Monitoring**: CloudWatch integration for logs, metrics, and alerts
- **Infrastructure as Code**: AWS CDK for reproducible deployments

## Project Structure

```
open-claw-fleet/
├── packages/           # Workspace packages (future agent configurations)
├── infra/             # AWS CDK infrastructure code
│   ├── bin/           # CDK app entry point
│   ├── lib/           # Stack definitions
│   └── package.json   # Infrastructure dependencies
├── scripts/           # Deployment and utility scripts
├── sample/            # Sample configurations and examples
│   └── openclaw/      # OpenClaw reference implementation
└── README.md          # This file
```

## Prerequisites

- **AWS Account** with appropriate permissions
- **Node.js** ≥ 20.0.0
- **AWS CDK** CLI installed (`npm install -g aws-cdk`)
- **Docker** for local testing
- **AWS CLI** configured with credentials

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/open-claw-fleet.git
cd open-claw-fleet
npm install
```

### 2. Configure Infrastructure

```bash
cd infra
npm install
```

### 3. Deploy to AWS

```bash
# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy the stack
cdk deploy
```

### 4. Configure Agents

(Coming soon: Agent configuration and deployment workflows)

## Roadmap

- [ ] Base ECS cluster infrastructure
- [ ] Container definitions for OpenClaw agents
- [ ] EFS integration for persistent storage
- [ ] Multi-agent communication patterns
- [ ] Role-based agent templates (CEO, VP, Manager, etc.)
- [ ] Messaging platform integrations
- [ ] Monitoring and observability dashboards
- [ ] Auto-scaling policies
- [ ] Cost optimization strategies
- [ ] Agent orchestration and coordination
- [ ] Web UI for fleet management

## Proof of Concepts

### [Matrix Agent Communication](poc/matrix-agents/)
Demonstrates multiple OpenClaw agents in separate Docker containers communicating via Matrix protocol. Verified working with Bedrock LLM (GPT OSS, Claude).

## Security Considerations

Running autonomous AI agents at scale requires careful security planning:

- **Network Isolation**: Agents run in private subnets with controlled egress
- **Credential Management**: AWS Secrets Manager for API keys and tokens
- **IAM Policies**: Least-privilege access for each agent role
- **Container Security**: Regular image scanning and updates
- **Audit Logging**: CloudTrail and CloudWatch for compliance
- **Approval Workflows**: Human-in-the-loop for sensitive operations

## Cost Estimation

Costs vary based on:
- Number of concurrent agents
- Container size (CPU/memory)
- EFS storage usage
- Data transfer
- LLM API calls (OpenAI, Anthropic, etc.)

Example: 100 agents running 24/7 on Fargate with 0.5 vCPU and 1GB memory:
- ECS Fargate: ~$1,500/month
- EFS Storage: ~$30/month (100GB)
- Data Transfer: Variable
- LLM API Costs: Variable (depends on usage)

## Contributing

Contributions are welcome! This is an open-source project aimed at democratizing access to autonomous AI agent infrastructure.

### Areas for Contribution

- Infrastructure improvements
- Agent templates and configurations
- Documentation and examples
- Security enhancements
- Cost optimization strategies
- Integration with additional services

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

- [OpenClaw](https://openclaw.ai) - The autonomous AI agent framework powering this fleet
- AWS CDK team for infrastructure-as-code tooling
- The open-source AI community

## Resources

- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)

## Support

For questions, issues, or discussions:
- Open an issue on GitHub
- Join our community Discord (coming soon)
- Check the documentation wiki

---

**Note**: This project is in active development. The infrastructure and agent deployment workflows are being built iteratively. Star and watch this repository for updates.
