# Product Overview

Open-Claw-Fleet enables organizations to deploy and manage fleets of autonomous AI agents on AWS infrastructure. Each agent runs in an isolated ECS container with persistent memory and can operate 24/7.

## Core Concept

Deploy complete organizational structures (executives, managers, individual contributors) as autonomous OpenClaw agents that can:
- Execute real tasks autonomously (not just suggestions)
- Maintain persistent memory across sessions
- Integrate with messaging platforms (WhatsApp, Telegram, Discord, Slack)
- Coordinate across multiple services
- Scale from single agents to thousands

## Architecture

- **Container-based**: Each agent runs in isolated ECS containers
- **Persistent Storage**: EFS-backed storage for agent memory
- **AWS Native**: Leverages ECS, VPC, IAM, CloudWatch, Secrets Manager
- **Infrastructure as Code**: AWS CDK for reproducible deployments

## What is OpenClaw?

OpenClaw is an open-source autonomous AI agent framework built in TypeScript that provides:
- Conversation-first interaction model
- Tool execution (shell commands, browser automation, file operations)
- Extensible plugin system for custom skills
- Multi-platform messaging integration

## Current Status

Project is in active development. Core infrastructure stack is being built to support agent deployment and orchestration.
